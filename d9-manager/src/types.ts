export interface NodeMetadataStruct {
  name: string;
  sharing_percent: number;
  index_of_last_percent_change: number;
}

export interface Language {
  code: 'en' | 'zh';
  name: string;
}

export interface Messages {
  welcome: string;
  languagePrompt: string;
  checkingBinary: string;
  binaryNotFound: string;
  keyAccessPrompt: string;
  checkingBalance: string;
  mainMenu: string;
  setupNewNode: string;
  submitCandidacy: string;
  convertNode: string;
  nodeTypes: {
    full: {
      name: string;
      description: string;
      requirements: string;
    };
    validator: {
      name: string;
      description: string;
      requirements: string;
    };
    archiver: {
      name: string;
      description: string;
      requirements: string;
    };
  };
  candidacyForm: {
    namePrompt: string;
    nameNote: string;
    confirmSubmission: string;
  };
  progress: {
    installing: string;
    configuring: string;
    complete: string;
  };
  errors: {
    insufficientFunds: string;
    networkError: string;
    keyNotFound: string;
    diskSpace: string;
  };
}

export enum NodeType {
  FULL = 'full',
  VALIDATOR = 'validator',
  ARCHIVER = 'archiver'
}

export interface SystemInfo {
  diskSpace: number;
  architecture: string;
  hasD9Binary: boolean;
  binaryPath?: string;
}