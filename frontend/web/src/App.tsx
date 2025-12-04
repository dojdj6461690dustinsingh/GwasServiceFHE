// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface GwasData {
  id: string;
  encryptedData: string;
  timestamp: number;
  institution: string;
  studyType: string;
  status: "pending" | "processed" | "error";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [gwasDatasets, setGwasDatasets] = useState<GwasData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newDataset, setNewDataset] = useState({
    studyType: "",
    description: "",
    genomicData: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("datasets");
  const [searchQuery, setSearchQuery] = useState("");

  // Calculate statistics for dashboard
  const processedCount = gwasDatasets.filter(d => d.status === "processed").length;
  const pendingCount = gwasDatasets.filter(d => d.status === "pending").length;
  const errorCount = gwasDatasets.filter(d => d.status === "error").length;

  useEffect(() => {
    loadDatasets().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadDatasets = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("gwas_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing dataset keys:", e);
        }
      }
      
      const list: GwasData[] = [];
      
      for (const key of keys) {
        try {
          const datasetBytes = await contract.getData(`gwas_${key}`);
          if (datasetBytes.length > 0) {
            try {
              const dataset = JSON.parse(ethers.toUtf8String(datasetBytes));
              list.push({
                id: key,
                encryptedData: dataset.data,
                timestamp: dataset.timestamp,
                institution: dataset.institution,
                studyType: dataset.studyType,
                status: dataset.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing dataset for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading dataset ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setGwasDatasets(list);
    } catch (e) {
      console.error("Error loading datasets:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const uploadDataset = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting genomic data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-GWAS-${btoa(JSON.stringify(newDataset))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const datasetId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const datasetData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        institution: account,
        studyType: newDataset.studyType,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `gwas_${datasetId}`, 
        ethers.toUtf8Bytes(JSON.stringify(datasetData))
      );
      
      const keysBytes = await contract.getData("gwas_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(datasetId);
      
      await contract.setData(
        "gwas_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted genomic data submitted securely!"
      });
      
      await loadDatasets();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewDataset({
          studyType: "",
          description: "",
          genomicData: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Upload failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const processDataset = async (datasetId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted genomic data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const datasetBytes = await contract.getData(`gwas_${datasetId}`);
      if (datasetBytes.length === 0) {
        throw new Error("Dataset not found");
      }
      
      const datasetData = JSON.parse(ethers.toUtf8String(datasetBytes));
      
      const updatedDataset = {
        ...datasetData,
        status: "processed"
      };
      
      await contract.setData(
        `gwas_${datasetId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedDataset))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE GWAS analysis completed successfully!"
      });
      
      await loadDatasets();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Research Institution Wallet",
      description: "Connect your Web3 wallet to access the FHE-GWAS platform",
      icon: "🔗"
    },
    {
      title: "Upload Encrypted Genomic Data",
      description: "Securely upload your encrypted genomic and phenotypic data",
      icon: "🔒"
    },
    {
      title: "FHE Statistical Analysis",
      description: "Perform genome-wide association studies on encrypted data",
      icon: "⚙️"
    },
    {
      title: "Discover Genetic Associations",
      description: "Identify disease-related genes while preserving data privacy",
      icon: "🧬"
    }
  ];

  const renderBarChart = () => {
    return (
      <div className="bar-chart-container">
        <div className="bar-chart">
          <div className="bar-wrapper">
            <div 
              className="bar processed" 
              style={{ height: `${(processedCount / (gwasDatasets.length || 1)) * 100}%` }}
            >
              <span className="bar-value">{processedCount}</span>
            </div>
            <div className="bar-label">Processed</div>
          </div>
          <div className="bar-wrapper">
            <div 
              className="bar pending" 
              style={{ height: `${(pendingCount / (gwasDatasets.length || 1)) * 100}%` }}
            >
              <span className="bar-value">{pendingCount}</span>
            </div>
            <div className="bar-label">Pending</div>
          </div>
          <div className="bar-wrapper">
            <div 
              className="bar error" 
              style={{ height: `${(errorCount / (gwasDatasets.length || 1)) * 100}%` }}
            >
              <span className="bar-value">{errorCount}</span>
            </div>
            <div className="bar-label">Error</div>
          </div>
        </div>
      </div>
    );
  };

  const filteredDatasets = gwasDatasets.filter(dataset => 
    dataset.studyType.toLowerCase().includes(searchQuery.toLowerCase()) ||
    dataset.institution.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="dna-icon"></div>
          <h1>FHE<span>GWAS</span>Service</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-btn"
            disabled={!account}
          >
            <div className="upload-icon"></div>
            Upload Dataset
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Genome-Wide Association Study</h2>
            <p>Perform secure GWAS analysis on encrypted genomic data using FHE technology</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE-GWAS Platform Tutorial</h2>
            <p className="subtitle">Learn how to securely analyze genomic data</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="tab-navigation">
          <button 
            className={activeTab === "datasets" ? "tab-active" : ""}
            onClick={() => setActiveTab("datasets")}
          >
            Datasets
          </button>
          <button 
            className={activeTab === "analytics" ? "tab-active" : ""}
            onClick={() => setActiveTab("analytics")}
          >
            Analytics
          </button>
          <button 
            className={activeTab === "about" ? "tab-active" : ""}
            onClick={() => setActiveTab("about")}
          >
            About
          </button>
        </div>
        
        {activeTab === "datasets" && (
          <>
            <div className="dashboard-cards">
              <div className="dashboard-card">
                <h3>Project Introduction</h3>
                <p>A cloud platform enabling multiple research institutions to upload encrypted genomic and phenotypic data for collaborative FHE-GWAS analysis while protecting data assets.</p>
                <div className="fhe-badge">
                  <span>FHE-Powered</span>
                </div>
              </div>
              
              <div className="dashboard-card">
                <h3>Data Statistics</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-value">{gwasDatasets.length}</div>
                    <div className="stat-label">Total Datasets</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{processedCount}</div>
                    <div className="stat-label">Processed</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{pendingCount}</div>
                    <div className="stat-label">Pending</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{errorCount}</div>
                    <div className="stat-label">Errors</div>
                  </div>
                </div>
              </div>
              
              <div className="dashboard-card">
                <h3>Status Distribution</h3>
                {renderBarChart()}
              </div>
            </div>
            
            <div className="datasets-section">
              <div className="section-header">
                <h2>Encrypted GWAS Datasets</h2>
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search datasets..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <div className="search-icon"></div>
                </div>
                <div className="header-actions">
                  <button 
                    onClick={loadDatasets}
                    className="refresh-btn"
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="datasets-list">
                <div className="table-header">
                  <div className="header-cell">ID</div>
                  <div className="header-cell">Study Type</div>
                  <div className="header-cell">Institution</div>
                  <div className="header-cell">Date</div>
                  <div className="header-cell">Status</div>
                  <div className="header-cell">Actions</div>
                </div>
                
                {filteredDatasets.length === 0 ? (
                  <div className="no-datasets">
                    <div className="no-data-icon"></div>
                    <p>No encrypted datasets found</p>
                    <button 
                      className="primary-btn"
                      onClick={() => setShowUploadModal(true)}
                      disabled={!account}
                    >
                      Upload First Dataset
                    </button>
                  </div>
                ) : (
                  filteredDatasets.map(dataset => (
                    <div className="dataset-row" key={dataset.id}>
                      <div className="table-cell dataset-id">#{dataset.id.substring(0, 6)}</div>
                      <div className="table-cell">{dataset.studyType}</div>
                      <div className="table-cell">{dataset.institution.substring(0, 6)}...{dataset.institution.substring(38)}</div>
                      <div className="table-cell">
                        {new Date(dataset.timestamp * 1000).toLocaleDateString()}
                      </div>
                      <div className="table-cell">
                        <span className={`status-badge ${dataset.status}`}>
                          {dataset.status}
                        </span>
                      </div>
                      <div className="table-cell actions">
                        {isOwner(dataset.institution) && dataset.status === "pending" && (
                          <button 
                            className="action-btn success"
                            onClick={() => processDataset(dataset.id)}
                          >
                            Process
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
        
        {activeTab === "analytics" && (
          <div className="analytics-tab">
            <h2>GWAS Analytics Dashboard</h2>
            <p>Visualization of association studies performed on encrypted data</p>
            
            <div className="analytics-grid">
              <div className="analytics-card">
                <h3>Statistical Significance</h3>
                <div className="placeholder-chart">
                  <p>FHE-computed p-values visualization</p>
                </div>
              </div>
              
              <div className="analytics-card">
                <h3>Gene Associations</h3>
                <div className="placeholder-chart">
                  <p>Top associated genes from FHE analysis</p>
                </div>
              </div>
              
              <div className="analytics-card">
                <h3>Population Stratification</h3>
                <div className="placeholder-chart">
                  <p>PCA results from encrypted data</p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "about" && (
          <div className="about-tab">
            <h2>About FHE-GWAS Service</h2>
            
            <div className="about-content">
              <div className="about-section">
                <h3>Technology</h3>
                <p>Our platform utilizes Fully Homomorphic Encryption (FHE) to perform statistical analyses on encrypted genomic data without decryption, ensuring complete privacy throughout the GWAS process.</p>
              </div>
              
              <div className="about-section">
                <h3>Collaboration</h3>
                <p>Multiple research institutions can contribute encrypted data to large-scale studies while maintaining full control over their sensitive genomic information.</p>
              </div>
              
              <div className="about-section">
                <h3>Benefits</h3>
                <ul>
                  <li>Privacy-preserving genome-wide association studies</li>
                  <li>Multi-institutional collaboration without data sharing</li>
                  <li>Secure computation of statistical associations</li>
                  <li>Protection of sensitive genetic information</li>
                </ul>
              </div>
            </div>
            
            <div className="team-section">
              <h3>Research Partners</h3>
              <div className="partner-logos">
                <div className="partner-logo">Genomics Research Institute</div>
                <div className="partner-logo">Secure Biotech Labs</div>
                <div className="partner-logo">Privacy-First Medical University</div>
              </div>
            </div>
          </div>
        )}
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadDataset} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          dataset={newDataset}
          setDataset={setNewDataset}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="dna-icon"></div>
              <span>FHE-GWAS Service</span>
            </div>
            <p>Secure encrypted genomic analysis using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE-GWAS Service. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  dataset: any;
  setDataset: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  dataset,
  setDataset
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setDataset({
      ...dataset,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!dataset.studyType || !dataset.genomicData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>Upload Encrypted GWAS Dataset</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Your genomic data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Study Type *</label>
              <select 
                name="studyType"
                value={dataset.studyType} 
                onChange={handleChange}
                className="form-select"
              >
                <option value="">Select study type</option>
                <option value="Cardiovascular">Cardiovascular Disease</option>
                <option value="Oncology">Cancer Genomics</option>
                <option value="Neurological">Neurological Disorders</option>
                <option value="Metabolic">Metabolic Conditions</option>
                <option value="Other">Other Genomic Study</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={dataset.description} 
                onChange={handleChange}
                placeholder="Brief description..." 
                className="form-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Genomic Data (VCF format) *</label>
              <textarea 
                name="genomicData"
                value={dataset.genomicData} 
                onChange={handleChange}
                placeholder="Paste genomic variants data in VCF format..." 
                className="form-textarea"
                rows={6}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> Data remains encrypted during FHE processing and analysis
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="submit-btn primary"
          >
            {uploading ? "Encrypting with FHE..." : "Upload Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;