/**
 * Polymarket Relayer Client
 * 
 * Used for setting allowances and executing Gnosis Safe transactions
 * through Polymarket's relayer (gasless transactions)
 */

import { Wallet } from '@ethersproject/wallet';
import { ethers } from 'ethers';
import axios from 'axios';

const RELAYER_URL = 'https://relayer-v2.polymarket.com';

// Contract addresses on Polygon
const CONTRACTS = {
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  CTF: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
  CTF_EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  NEG_RISK_CTF_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
  NEG_RISK_ADAPTER: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296',
  GNOSIS_MULTI_SEND: '0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761',
};

// Gnosis Safe domain
const SAFE_DOMAIN = {
  chainId: 137,
};

// EIP-712 types for Gnosis Safe
const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
};

export class RelayerClient {
  private wallet: Wallet;
  private proxyWallet: string;

  constructor(privateKey: string, proxyWallet: string) {
    this.wallet = new Wallet(privateKey);
    this.proxyWallet = proxyWallet;
  }

  /**
   * Get current nonce for the Safe
   */
  async getNonce(): Promise<string> {
    const response = await axios.get(`${RELAYER_URL}/nonce`, {
      params: {
        address: this.wallet.address,
        type: 'SAFE',
      },
    });
    return response.data.nonce;
  }

  /**
   * Check transaction status
   */
  async getTransactionStatus(transactionId: string): Promise<any> {
    const response = await axios.get(`${RELAYER_URL}/transaction`, {
      params: { id: transactionId },
    });
    return response.data;
  }

  /**
   * Build ERC20 approve calldata
   */
  private buildApproveData(spender: string): string {
    const iface = new ethers.utils.Interface([
      'function approve(address spender, uint256 amount)',
    ]);
    return iface.encodeFunctionData('approve', [
      spender,
      ethers.constants.MaxUint256,
    ]);
  }

  /**
   * Build ERC1155 setApprovalForAll calldata
   */
  private buildSetApprovalForAllData(operator: string): string {
    const iface = new ethers.utils.Interface([
      'function setApprovalForAll(address operator, bool approved)',
    ]);
    return iface.encodeFunctionData('setApprovalForAll', [operator, true]);
  }

  /**
   * Encode MultiSend transactions
   * Format: operation (1 byte) + to (20 bytes) + value (32 bytes) + dataLength (32 bytes) + data
   */
  private encodeMultiSendTransaction(
    operation: number,
    to: string,
    value: number,
    data: string
  ): string {
    const dataBytes = ethers.utils.arrayify(data);
    const packed = ethers.utils.solidityPack(
      ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
      [operation, to, value, dataBytes.length, dataBytes]
    );
    return packed.slice(2); // Remove 0x prefix
  }

  /**
   * Build MultiSend data for all approvals
   */
  private buildMultiSendData(): string {
    const transactions: string[] = [];

    // USDC approvals
    const usdcApprovals = [
      CONTRACTS.CTF, // Approve CTF contract
      CONTRACTS.CTF_EXCHANGE,
      CONTRACTS.NEG_RISK_CTF_EXCHANGE,
      CONTRACTS.NEG_RISK_ADAPTER,
    ];

    for (const spender of usdcApprovals) {
      const approveData = this.buildApproveData(spender);
      transactions.push(
        this.encodeMultiSendTransaction(0, CONTRACTS.USDC, 0, approveData)
      );
    }

    // CTF setApprovalForAll
    const ctfApprovals = [
      CONTRACTS.CTF_EXCHANGE,
      CONTRACTS.NEG_RISK_CTF_EXCHANGE,
      CONTRACTS.NEG_RISK_ADAPTER,
    ];

    for (const operator of ctfApprovals) {
      const approvalData = this.buildSetApprovalForAllData(operator);
      transactions.push(
        this.encodeMultiSendTransaction(0, CONTRACTS.CTF, 0, approvalData)
      );
    }

    // Combine all transactions
    const combinedData = '0x' + transactions.join('');

    // Encode multiSend call
    const multiSendIface = new ethers.utils.Interface([
      'function multiSend(bytes memory transactions)',
    ]);
    return multiSendIface.encodeFunctionData('multiSend', [combinedData]);
  }

  /**
   * Sign Safe transaction using EIP-712
   */
  private async signSafeTransaction(
    to: string,
    data: string,
    nonce: string
  ): Promise<string> {
    const domain = {
      ...SAFE_DOMAIN,
      verifyingContract: this.proxyWallet,
    };

    const message = {
      to,
      value: 0,
      data,
      operation: 1, // DelegateCall for MultiSend
      safeTxGas: 0,
      baseGas: 0,
      gasPrice: 0,
      gasToken: ethers.constants.AddressZero,
      refundReceiver: ethers.constants.AddressZero,
      nonce: parseInt(nonce),
    };

    const signature = await this.wallet._signTypedData(
      domain,
      SAFE_TX_TYPES,
      message
    );

    return signature;
  }

  /**
   * Submit transaction to relayer
   */
  async submitTransaction(
    to: string,
    data: string,
    nonce: string,
    signature: string,
    metadata: string = 'approval'
  ): Promise<any> {
    const payload = {
      from: this.wallet.address,
      to,
      proxyWallet: this.proxyWallet,
      data,
      nonce,
      signature,
      signatureParams: {
        gasPrice: '0',
        operation: '1',
        safeTxnGas: '0',
        baseGas: '0',
        gasToken: ethers.constants.AddressZero,
        refundReceiver: ethers.constants.AddressZero,
      },
      type: 'SAFE',
      metadata,
    };

    const response = await axios.post(`${RELAYER_URL}/submit`, payload, {
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://polymarket.com',
        Referer: 'https://polymarket.com/',
      },
    });

    return response.data;
  }

  /**
   * Wait for transaction to be mined
   */
  async waitForTransaction(
    transactionId: string,
    timeoutMs: number = 120000
  ): Promise<any> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getTransactionStatus(transactionId);
      const tx = status[0];

      if (tx.state === 'STATE_MINED') {
        return tx;
      }

      if (tx.state === 'STATE_FAILED') {
        throw new Error(`Transaction failed: ${tx.transactionHash}`);
      }

      // Wait 2 seconds before polling again
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error('Transaction timeout');
  }

  /**
   * Set all required allowances for trading
   */
  async setAllowances(): Promise<{
    transactionId: string;
    transactionHash: string;
  }> {
    console.log('🔧 Setting allowances via relayer...');
    console.log('');

    // 1. Get nonce
    console.log('1️⃣ Getting nonce...');
    const nonce = await this.getNonce();
    console.log('   Nonce:', nonce);

    // 2. Build MultiSend data
    console.log('2️⃣ Building approval transactions...');
    const multiSendData = this.buildMultiSendData();
    console.log('   Data length:', multiSendData.length, 'bytes');

    // 3. Sign transaction
    console.log('3️⃣ Signing Safe transaction...');
    const signature = await this.signSafeTransaction(
      CONTRACTS.GNOSIS_MULTI_SEND,
      multiSendData,
      nonce
    );
    console.log('   Signature:', signature.substring(0, 20) + '...');

    // 4. Submit to relayer
    console.log('4️⃣ Submitting to relayer...');
    const result = await this.submitTransaction(
      CONTRACTS.GNOSIS_MULTI_SEND,
      multiSendData,
      nonce,
      signature,
      'approval'
    );
    console.log('   Transaction ID:', result.transactionID);
    console.log('   Transaction Hash:', result.transactionHash);

    // 5. Wait for mining
    console.log('5️⃣ Waiting for transaction to be mined...');
    const finalTx = await this.waitForTransaction(result.transactionID);
    console.log('   ✅ Transaction mined!');
    console.log('   Final state:', finalTx.state);

    return {
      transactionId: result.transactionID,
      transactionHash: result.transactionHash,
    };
  }
}

/**
 * Set allowances using environment variables
 */
export async function setAllowancesFromEnv(): Promise<void> {
  const privateKey = process.env.PRIVATE_KEY;
  const proxyWallet = process.env.FUNDER_ADDRESS;

  if (!privateKey || !proxyWallet) {
    throw new Error('PRIVATE_KEY and FUNDER_ADDRESS must be set in .env');
  }

  const relayer = new RelayerClient(privateKey, proxyWallet);
  await relayer.setAllowances();
}

