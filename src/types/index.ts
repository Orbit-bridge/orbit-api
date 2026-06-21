export type Chain =
  | 'ethereum' | 'base' | 'arbitrum' | 'optimism'
  | 'polygon' | 'avalanche' | 'bsc' | 'solana' | 'stellar';

export interface ApiRoute {
  routeId:              string;
  fromChain:            Chain;
  toChain:              Chain;
  fromAsset:            string;
  toAsset:              string;
  fromAmount:           string;
  toAmount:             string;
  estimatedTimeSeconds: number;
  estimatedCost: {
    gasFeeUSD:      string;
    bridgeFeeUSD:   string;
    slippagePercent: string;
    totalUSD:        string;
  };
  risk: {
    overallScore:     number;
    warnings:         string[];
  };
  recommended: boolean;
  tags:        string[];
  expiresAt:   number;
}

export interface QuoteRequest {
  fromChain:  Chain;
  toChain:    Chain;
  fromAsset:  string;
  toAsset:    string;
  amount:     string;
  slippage?:  number;
}

export interface QuoteResponse {
  requestId:   string;
  routes:      ApiRoute[];
  generatedAt: number;
}

export interface ExecuteRequest {
  routeId:       string;
  signerAddress: string;
  slippage?:     number;
}

export interface ExecuteResponse {
  executionId: string;
  status:      string;
  routeId:     string;
}

export interface StatusResponse {
  executionId: string;
  status:      string;
  steps:       Array<{
    stepId:    number;
    status:    string;
    txHash?:   string;
    error?:    string;
  }>;
  updatedAt:   number;
  completedAt?: number;
  error?:      string;
}

export interface ApiError {
  error:   string;
  code:    string;
  status:  number;
}
