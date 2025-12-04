// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract GwasServiceFHE is SepoliaConfig {
    struct EncryptedGenomeData {
        uint256 id;
        euint32 encryptedGenotype;    // Encrypted genotype data
        euint32 encryptedPhenotype;   // Encrypted phenotype data
        address institution;          // Data provider
        uint256 timestamp;
    }
    
    struct AnalysisResult {
        euint32 encryptedPValue;      // Encrypted p-value from association test
        euint32 encryptedOddsRatio;   // Encrypted odds ratio
        bool isRevealed;
    }

    uint256 public datasetCount;
    mapping(uint256 => EncryptedGenomeData) public encryptedDatasets;
    mapping(uint256 => AnalysisResult) public analysisResults;
    
    mapping(uint256 => euint32) private encryptedGeneCounts;
    uint256[] private geneMarkers;
    
    mapping(uint256 => uint256) private requestToDatasetId;
    
    event DatasetSubmitted(uint256 indexed id, address indexed institution);
    event AnalysisRequested(uint256 indexed id);
    event ResultDecrypted(uint256 indexed id);
    
    modifier onlyInstitution(uint256 datasetId) {
        require(msg.sender == encryptedDatasets[datasetId].institution, "Not authorized");
        _;
    }
    
    function submitEncryptedDataset(
        euint32 encryptedGenotype,
        euint32 encryptedPhenotype
    ) public {
        datasetCount += 1;
        uint256 newId = datasetCount;
        
        encryptedDatasets[newId] = EncryptedGenomeData({
            id: newId,
            encryptedGenotype: encryptedGenotype,
            encryptedPhenotype: encryptedPhenotype,
            institution: msg.sender,
            timestamp: block.timestamp
        });
        
        analysisResults[newId] = AnalysisResult({
            encryptedPValue: FHE.asEuint32(0),
            encryptedOddsRatio: FHE.asEuint32(0),
            isRevealed: false
        });
        
        emit DatasetSubmitted(newId, msg.sender);
    }
    
    function requestGWASAnalysis(uint256 datasetId) public onlyInstitution(datasetId) {
        EncryptedGenomeData storage data = encryptedDatasets[datasetId];
        require(!analysisResults[datasetId].isRevealed, "Already analyzed");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(data.encryptedGenotype);
        ciphertexts[1] = FHE.toBytes32(data.encryptedPhenotype);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.performAnalysis.selector);
        requestToDatasetId[reqId] = datasetId;
        
        emit AnalysisRequested(datasetId);
    }
    
    function performAnalysis(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 datasetId = requestToDatasetId[requestId];
        require(datasetId != 0, "Invalid request");
        
        AnalysisResult storage result = analysisResults[datasetId];
        require(!result.isRevealed, "Already analyzed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory values = abi.decode(cleartexts, (uint32[]));
        uint32 genotype = values[0];
        uint32 phenotype = values[1];
        
        // Perform statistical analysis (simplified)
        uint32 pValue = calculatePValue(genotype, phenotype);
        uint32 oddsRatio = calculateOddsRatio(genotype, phenotype);
        
        result.encryptedPValue = FHE.asEuint32(pValue);
        result.encryptedOddsRatio = FHE.asEuint32(oddsRatio);
        result.isRevealed = true;
        
        emit ResultDecrypted(datasetId);
    }
    
    function getAnalysisResult(uint256 datasetId) public view returns (
        euint32 pValue,
        euint32 oddsRatio,
        bool isRevealed
    ) {
        AnalysisResult storage r = analysisResults[datasetId];
        return (r.encryptedPValue, r.encryptedOddsRatio, r.isRevealed);
    }
    
    function requestResultDecryption(uint256 datasetId) public onlyInstitution(datasetId) {
        AnalysisResult storage result = analysisResults[datasetId];
        require(result.isRevealed, "Analysis not complete");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(result.encryptedPValue);
        ciphertexts[1] = FHE.toBytes32(result.encryptedOddsRatio);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptFinalResults.selector);
        requestToDatasetId[reqId] = datasetId;
    }
    
    function decryptFinalResults(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 datasetId = requestToDatasetId[requestId];
        require(datasetId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        // Process decrypted results as needed
    }
    
    // Statistical calculation helpers (simplified)
    function calculatePValue(uint32 genotype, uint32 phenotype) private pure returns (uint32) {
        // Placeholder for actual statistical calculation
        return genotype + phenotype;
    }
    
    function calculateOddsRatio(uint32 genotype, uint32 phenotype) private pure returns (uint32) {
        // Placeholder for actual odds ratio calculation
        return genotype * phenotype;
    }
}