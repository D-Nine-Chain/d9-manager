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
    noInstallation: string;
    title: string;
    mode: string;
    nodeType: string;
    started: string;
    progressLabel: string;
    stepsLabel: string;
    errorLabel: string;
  };
  errors: {
    insufficientFunds: string;
    networkError: string;
    keyNotFound: string;
    diskSpace: string;
  };
  setup: {
    checkingRequirements: string;
    osCompatible: string;
    osIncompatible: string;
    archCompatible: string;
    archIncompatible: string;
    selectNodeType: string;
    continueWithNodeType: string;
    checkingDiskSpace: string;
    currentDiskUsage: string;
    requiredSpace: string;
    sufficientDiskSpace: string;
    insufficientDiskSpace: string;
    configuringSwap: string;
    swapConfigured: string;
    runningInMode: string;
    creatingServiceUser: string;
    serviceUserExists: string;
    serviceUserCreated: string;
    startingInstallation: string;
    updatingPackages: string;
    packagesUpdated: string;
    installingPackages: string;
    packagesInstalled: string;
    checkingGlibc: string;
    glibcCompatible: string;
    glibcIncompatible: string;
    upgradingGlibc: string;
    fetchingRelease: string;
    downloadingBinary: string;
    downloadingChecksum: string;
    verifyingIntegrity: string;
    integrityVerified: string;
    extractingBinary: string;
    binaryExtracted: string;
    installingBinary: string;
    downloadingChainSpec: string;
    chainSpecDownloaded: string;
    creatingDataDir: string;
    installationComplete: string;
    enterNodeName: string;
    startingNodeService: string;
    nodeStartingUp: string;
    recentLogs: string;
    pressCtrlC: string;
    keysAlreadyExist: string;
    noKeysFound: string;
    generateNewKeys: string;
    stoppingService: string;
    serviceNotRunning: string;
    generatingSeed: string;
    importantSaveThis: string;
    pressEnterWhenSaved: string;
    selectSecurityMode: string;
    securityModes: {
      easy: string;
      advanced: string;
      legacy: string;
    };
    existingInstallation: string;
    advancedKeyGeneration: string;
    advancedKeyGenDescription: string;
    creatingSecurePassword: string;
    enterPasswordPrompt: string;
    confirmPasswordPrompt: string;
    passwordsDoNotMatch: string;
    generatingRootMnemonic: string;
    criticalSecurityInfo: string;
    rootMnemonicLabel: string;
    rootMnemonicWarning1: string;
    rootMnemonicWarning2: string;
    rootMnemonicWarning3: string;
    understandNotStored: string;
    mustAcknowledge: string;
    secondConfirmation: string;
    rootNotStoredWarning: string;
    mustSaveYourself: string;
    confirmUnderstand: string;
    iUnderstandOption: string;
    cancelOption: string;
    setupCancelled: string;
    verifyingBackup: string;
    provideWords: string;
    wordPrompt: string;
    incorrectWord: string;
    mnemonicVerified: string;
    derivingSessionKeys: string;
    generatingDeterministic: string;
    onlyDerivedStored: string;
    derivingKeyFrom: string;
    yourSessionKeys: string;
    sessionKeysDescription: string;
    publicKeysOnly: string;
    onlyDerivedHex: string;
    rootNeverStored: string;
    filesGenerated: string;
    certificateFile: string;
    debugFile: string;
    ubuntu2204: string;
    debian12: string;
    currentGlibcVersion: string;
    requiredGlibcVersion: string;
    addingUbuntuRepo: string;
    addingDebianRepo: string;
    updatingPackageLists: string;
    installingNewGlibc: string;
    newGlibcVersion: string;
    glibcUpgradeSuccess: string;
    downloadUrl: string;
    hashUrl: string;
    preparingChecksum: string;
    extractingArchive: string;
    installingToUsrBin: string;
    downloadingChainSpec2: string;
    creatingDataDirectory: string;
    stoppingService2: string;
    currently: string;
    publicSessionKeys: string;
    publicAddressesOnly: string;
    derivedKeysStored: string;
    rootNotStoredLocal: string;
    filesGenerated2: string;
    shareThisCert: string;
    technicalDetails: string;
    suriExplanationTitle: string;
    suriExplanationDesc: string;
    suriFormatLabel: string;
    suriExampleBase: string;
    suriExampleDerived: string;
    suriExampleAdvanced: string;
    suriAutoProvided: string;
    suriHierarchicalTitle: string;
    suriHierarchicalDesc: string;
    suriHierarchicalFormat: string;
    suriHierarchicalExample1: string;
    suriHierarchicalExample2: string;
    suriHierarchicalNote: string;
    insertingKeyType: string;
    suriErrorHelp: string;
    suriErrorExample: string;
  };
  keyGeneration: {
    generatingSeedPhrase: string;
    importantSavePhrase: string;
    seedPhraseLabel: string;
    pressEnterWhenSaved: string;
    advancedModeTitle: string;
    advancedModeDesc: string;
    securingKeys: string;
    creatingPassword: string;
    enterPassword: string;
    confirmPassword: string;
    passwordMismatch: string;
    generatingRootMnemonic: string;
    criticalSecurityTitle: string;
    rootMnemonicLabel: string;
    rootNotStoredWarning1: string;
    rootNotStoredWarning2: string;
    rootNotStoredWarning3: string;
    understandPrompt: string;
    mustAcknowledge: string;
    secondConfirmTitle: string;
    rootNotStoredLocalWarning: string;
    mustSaveWarning: string;
    confirmOptions: string;
    optionUnderstand: string;
    optionCancel: string;
    setupCancelled: string;
    verifyingBackup: string;
    provideWordsPrompt: string;
    wordNumberPrompt: string;
    incorrectWordError: string;
    verificationSuccess: string;
    derivingKeys: string;
    currentlyDeriving: string;
    keyInserted: string;
  };
  transaction: {
    startingExecution: string;
    pendingSteps: string;
    executing: string;
    alreadyDone: string;
    validationFailed: string;
    failed: string;
    completed: string;
    completedSuccessfully: string;
    transactionFailed: string;
    rollingBack: string;
    rolledBack: string;
    rollbackFailed: string;
    stateSaved: string;
    stateCleared: string;
    resuming: string;
    notInitialized: string;
    noExistingTransaction: string;
    cannotResume: string;
    stepNotFound: string;
    operationNotFound: string;
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