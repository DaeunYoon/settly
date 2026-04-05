// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CCTPBridge — Reference implementation for Circle CCTP bridging
/// @notice This contract is NOT used in the hackathon demo (bridge is simulated by backend).
///         It shows how real USDC bridging would work on mainnet between Arc and Base via CCTP.
///
/// CCTP (Cross-Chain Transfer Protocol) burns USDC on source chain and mints on destination.
/// Flow:
///   1. Approve USDC to TokenMessenger
///   2. Call depositForBurn() — burns USDC, emits message
///   3. Wait for Circle attestation service (~1-2 min testnet, ~15 min mainnet)
///   4. Poll https://iris-api.circle.com/attestations/{messageHash}
///   5. Call receiveMessage() on destination chain — mints USDC
///
/// Domain IDs:
///   Arc Testnet:     26
///   Base:            6
///   Base Sepolia:    6 (same as mainnet)
///   Ethereum:        0
///   Arbitrum:        3

interface ITokenMessenger {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken
    ) external returns (uint64 nonce);
}

interface IMessageTransmitter {
    function receiveMessage(
        bytes calldata message,
        bytes calldata attestation
    ) external returns (bool success);
}

contract CCTPBridge {
    // Arc Testnet CCTP addresses
    address public constant TOKEN_MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    address public constant MESSAGE_TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    // Arc ERC-20 USDC
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    // CCTP domain IDs
    uint32 public constant DOMAIN_ARC = 26;
    uint32 public constant DOMAIN_BASE = 6;
    uint32 public constant DOMAIN_ETHEREUM = 0;
    uint32 public constant DOMAIN_ARBITRUM = 3;

    /// @notice Bridge USDC from Arc to Base via CCTP
    /// @param amount USDC amount to bridge (6 decimals)
    /// @param recipient Address on Base to receive minted USDC
    /// @return nonce The CCTP message nonce (used to track attestation)
    function bridgeToBase(
        uint256 amount,
        address recipient
    ) external returns (uint64 nonce) {
        // 1. Approve TokenMessenger to burn USDC
        // IERC20(USDC).approve(TOKEN_MESSENGER, amount);

        // 2. Burn USDC on Arc, mint on Base
        //    mintRecipient must be bytes32-encoded address
        bytes32 mintRecipient = bytes32(uint256(uint160(recipient)));

        nonce = ITokenMessenger(TOKEN_MESSENGER).depositForBurn(
            amount,
            DOMAIN_BASE,        // destination: Base
            mintRecipient,
            USDC                // token to burn
        );

        // 3. Off-chain: poll Circle attestation API
        //    GET https://iris-api-sandbox.circle.com/attestations/{messageHash}
        //    Wait until status == "complete"
        //
        // 4. On Base: call MessageTransmitter.receiveMessage(message, attestation)
        //    This mints USDC to the recipient on Base
    }

    /// @notice Bridge USDC from Base back to Arc via CCTP (called on Base)
    /// @dev This function would be deployed on Base, not Arc
    function bridgeToArc(
        uint256 amount,
        address recipient
    ) external returns (uint64 nonce) {
        bytes32 mintRecipient = bytes32(uint256(uint160(recipient)));

        // On Base, use Base's TokenMessenger address
        // nonce = ITokenMessenger(BASE_TOKEN_MESSENGER).depositForBurn(
        //     amount,
        //     DOMAIN_ARC,         // destination: Arc
        //     mintRecipient,
        //     BASE_USDC           // Base USDC address
        // );

        // Same attestation flow as above
    }
}
