# D9 Node Manager

A comprehensive CLI tool for managing D9 blockchain nodes with zero-friction installation and operation.

## 🚀 Quick Install

**Download and install the pre-built binary:**

### Linux (x86_64)
```bash
curl -L https://github.com/D-Nine-Chain/d9-manager/releases/latest/download/d9-manager-linux-x64.gz | gunzip > d9-manager && chmod +x d9-manager && sudo mv d9-manager /usr/local/bin/
```

### Linux (ARM64)
```bash
curl -L https://github.com/D-Nine-Chain/d9-manager/releases/latest/download/d9-manager-linux-arm64.gz | gunzip > d9-manager && chmod +x d9-manager && sudo mv d9-manager /usr/local/bin/
```

### macOS (Apple Silicon - M1/M2)
```bash
curl -L https://github.com/D-Nine-Chain/d9-manager/releases/latest/download/d9-manager-macos-arm64.gz | gunzip > d9-manager && chmod +x d9-manager && sudo mv d9-manager /usr/local/bin/
```

### macOS (Intel)
```bash
curl -L https://github.com/D-Nine-Chain/d9-manager/releases/latest/download/d9-manager-macos-x64.gz | gunzip > d9-manager && chmod +x d9-manager && sudo mv d9-manager /usr/local/bin/
```

### Windows
Download `d9-manager-windows-x64.zip` from the [releases page](https://github.com/D-Nine-Chain/d9-manager/releases/latest), extract, and run.

Then simply run:
```bash
d9-manager
```

## ✨ Features

- **🌍 Multi-language Support**: English and Chinese
- **🔧 Easy Setup**: Install and configure D9 nodes with guided setup
- **⚡ Node Types**: Support for Full, Validator, and Archiver nodes
- **🗳️ Validator Management**: Submit candidacy and manage validator nodes
- **🔄 Node Conversion**: Convert between different node types
- **💰 Balance Checking**: Check account balances on D9 network
- **📊 Status Monitoring**: Real-time node status and logs
- **🔐 Keystore Management**: Secure key handling and address derivation

## 📋 Requirements

- Ubuntu 22.04+ (other Linux distributions may work but are untested)
- At least 60GB free disk space (120GB for archiver nodes)
- Internet connection
- sudo privileges for system service management

## 🛠️ Building from Source

1. **Install Deno** (if not already installed):
   ```bash
   curl -fsSL https://deno.land/install.sh | sh
   ```

2. **Clone the repository**:
   ```bash
   git clone https://github.com/D-Nine-Chain/d9-manager.git
   cd d9-manager
   ```

3. **Build the binary**:
   ```bash
   chmod +x build.sh
   ./build.sh
   ```

4. **Install globally**:
   ```bash
   sudo mv ./dist/d9-manager /usr/local/bin/
   ```

## 📖 Usage

### Starting the Manager
```bash
d9-manager
```

### Main Features

1. **Setup New Node**
   - Choose between Full, Validator, or Archiver node
   - Automatic system requirements checking
   - Guided installation process
   - Key generation and management

2. **Submit Validator Candidacy**
   - Convert node to validator configuration
   - Submit candidacy to D9 network
   - Balance checking and transaction submission

3. **Convert Existing Node**
   - Change node type without reinstallation
   - Preserve existing data and keys
   - Seamless configuration updates

4. **Node Status Monitoring**
   - Check service status
   - View recent logs
   - Monitor disk usage

## 🌐 Network Configuration

- **Endpoint**: `wss://mainnet.d9network.com:40300`
- **Chain**: D9 Mainnet
- **Keystore Path**: `/home/ubuntu/node-data/chains/d9_main/keystore`
- **Binary Paths**: `/usr/local/bin/d9-node` or `/home/ubuntu/d9_node/target/release/d9-node`

## 🔐 Security

- Keys are stored locally in the standard D9 keystore format
- No private keys are transmitted over the network
- All transactions are signed locally
- Service files run with restricted ubuntu user privileges

## 🤝 Validator Information

- Only top 27 voted nodes can be active validators
- Validators must remain online or risk being removed
- Validator candidacy requires community voting
- Sharing percentage is set to 0% by default

## 🐛 Troubleshooting

### Common Issues

1. **Binary not found**:
   ```bash
   # Check if D9 binary exists
   which d9-node
   ls -la /usr/local/bin/d9-node
   ```

2. **Service not starting**:
   ```bash
   # Check service logs
   journalctl -u d9-node.service -n 50
   
   # Check service status
   sudo systemctl status d9-node.service
   ```

3. **Key errors**:
   ```bash
   # Check keystore directory
   ls -la /home/ubuntu/node-data/chains/d9_main/keystore/
   ```

4. **Network connection issues**:
   - Ensure port 40100 is not blocked
   - Check firewall settings
   - Verify internet connectivity

### Useful Commands

```bash
# View node logs in real-time
journalctl -u d9-node.service -f

# Restart the node
sudo systemctl restart d9-node.service

# Check node status
sudo systemctl status d9-node.service

# Check disk usage
df -h /home/ubuntu/node-data
```

## 📁 File Structure

```
d9-manager/
├── src/
│   ├── main.ts              # Main application entry
│   ├── types.ts             # Type definitions
│   ├── i18n.ts              # Internationalization
│   ├── utils/
│   │   ├── system.ts        # System utilities
│   │   ├── keystore.ts      # Keystore management
│   │   └── polkadot.ts      # Blockchain interaction
│   └── commands/
│       ├── setup.ts         # Node setup commands
│       ├── candidacy.ts     # Validator candidacy
│       └── convert.ts       # Node conversion
├── deno.json                # Deno configuration
├── install.sh               # Installation script
└── README.md                # This file
```

## 🔄 Development

### Prerequisites
- Deno 1.40+
- Ubuntu 22.04+ for testing

### Running in Development
```bash
deno task dev
```

### Building
```bash
deno task build
```

### Testing
```bash
# Test on a Ubuntu system with D9 node
./dist/d9-manager
```

## 📄 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on Ubuntu
5. Submit a pull request

## 📞 Support

- Create an issue on GitHub for bugs or feature requests
- Check the troubleshooting section above
- Review D9 network documentation

## 🔗 Links

- [D9 Network](https://d9network.com)
- [D9 Node Repository](https://github.com/D-Nine-Chain/d9_node)
- [Deno Documentation](https://deno.land/manual)