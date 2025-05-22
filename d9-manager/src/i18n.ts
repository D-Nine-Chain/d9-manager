import { Messages } from './types.ts';

export const messages: Record<'en' | 'zh', Messages> = {
  en: {
    welcome: '🚀 D9 Node Manager',
    languagePrompt: 'Choose your language / 选择您的语言',
    checkingBinary: 'Checking for D9 node binary, please hold...',
    binaryNotFound: 'D9 node binary not found. Would you like to install it?',
    keyAccessPrompt: 'Can we access your node\'s keystore? (y/n)',
    checkingBalance: 'Checking account balance...',
    mainMenu: 'What would you like to do?',
    setupNewNode: 'Setup a new node',
    submitCandidacy: 'Submit validator candidacy',
    convertNode: 'Convert existing node',
    nodeTypes: {
      full: {
        name: 'Full Node',
        description: 'A full node that validates transactions and maintains the complete blockchain state',
        requirements: 'Requires at least 60GB of storage'
      },
      validator: {
        name: 'Validator Node', 
        description: 'A validator node that participates in consensus. Must be voted for by the community. Only top 27 nodes can be validators and must remain online.',
        requirements: 'Requires at least 60GB of storage'
      },
      archiver: {
        name: 'Archiver Node',
        description: 'An archiver node that stores historical blockchain data',
        requirements: 'Requires at least 120GB of storage'
      }
    },
    candidacyForm: {
      namePrompt: 'What name do you want the public to see?',
      nameNote: 'Note: This name will be visible to everyone on the network',
      confirmSubmission: 'Submit candidacy with this information?'
    },
    progress: {
      installing: 'Installing D9 node...',
      configuring: 'Configuring node...',
      complete: 'Setup complete!'
    },
    errors: {
      insufficientFunds: 'Insufficient funds for transaction',
      networkError: 'Network connection error',
      keyNotFound: 'Keystore not found or invalid',
      diskSpace: 'Insufficient disk space'
    }
  },
  zh: {
    welcome: '🚀 D9 节点管理器',
    languagePrompt: 'Choose your language / 选择您的语言',
    checkingBinary: '正在检查 D9 节点二进制文件，请稍候...',
    binaryNotFound: '未找到 D9 节点二进制文件。您想要安装它吗？',
    keyAccessPrompt: '我们可以访问您节点的密钥库吗？(y/n)',
    checkingBalance: '正在检查账户余额...',
    mainMenu: '您想要做什么？',
    setupNewNode: '设置新节点',
    submitCandidacy: '提交验证者候选',
    convertNode: '转换现有节点',
    nodeTypes: {
      full: {
        name: '全节点',
        description: '验证交易并维护完整区块链状态的全节点',
        requirements: '需要至少 60GB 存储空间'
      },
      validator: {
        name: '验证者节点',
        description: '参与共识的验证者节点。必须获得社区投票。只有前27个节点可以成为验证者，且必须保持在线。',
        requirements: '需要至少 60GB 存储空间'
      },
      archiver: {
        name: '归档节点',
        description: '存储历史区块链数据的归档节点',
        requirements: '需要至少 120GB 存储空间'
      }
    },
    candidacyForm: {
      namePrompt: '您希望公众看到什么名字？',
      nameNote: '注意：此名字将对网络上的所有人可见',
      confirmSubmission: '使用此信息提交候选？'
    },
    progress: {
      installing: '正在安装 D9 节点...',
      configuring: '正在配置节点...',
      complete: '设置完成！'
    },
    errors: {
      insufficientFunds: '交易资金不足',
      networkError: '网络连接错误',
      keyNotFound: '未找到密钥库或密钥库无效',
      diskSpace: '磁盘空间不足'
    }
  }
};

export function getMessage(lang: 'en' | 'zh'): Messages {
  return messages[lang];
}