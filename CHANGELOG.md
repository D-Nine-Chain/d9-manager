# Changelog

All notable changes to D9 Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2025-06-06

### Breaking Changes
- **Changed default data directory location** from user home to `/var/lib/d9-node` for new installations
- **Introduced dedicated service user** (`d9-node`) for enhanced security in new installations
- Legacy mode auto-detection preserves compatibility with existing installations

### Added
- **Multiple installation modes**:
  - Easy mode: Automated secure setup (recommended)
  - Hard mode: Maximum security with HD key derivation and password protection
  - Legacy mode: Automatic compatibility for existing installations
- **Debian 12 support** in addition to Ubuntu 22.04
- **Authority Discovery key** (4th validator key) generation
- **Enhanced key security** in hard mode:
  - Password-protected root mnemonic generation
  - Hierarchical deterministic key derivation
  - Mnemonic verification process
  - Certificate generation with validator information
- **Improved GLIBC 2.38 compatibility** for both Ubuntu and Debian

### Improved
- **Security hardening**:
  - Dedicated system user with restricted permissions
  - Enhanced file permission management
  - No shell access for service user
- **Better error handling** and diagnostics throughout setup process
- **Automatic OS detection** with appropriate user configuration
- **Repository management** with proper APT pinning for Debian

### Fixed
- Makefile syntax error in version comment

## [1.0.4] - 2025-05-30

### Improved
- Enhanced GLIBC error messages with detailed diagnostics
- Added specific error details and command output to GLIBC failures
- Included common failure reasons (package conflicts, dependencies, network issues)
- Show actual vs expected output format for parsing errors
- Display version numbers when upgrade attempts fail
- Provide clearer troubleshooting guidance

## [1.0.3] - 2025-05-29

### Fixed
- GLIBC 2.38 compatibility issue in node setup
- Automatic log viewing after node startup

### Improved
- Error handling during d9-node installation

### Added
- Initial release of D9 Node Manager
- Multi-language support (English/Chinese)
- Cross-platform binary builds for Linux, macOS, and Windows
- Node setup functionality (Full/Validator/Archiver)
- Validator candidacy submission
- Node conversion between types
- Balance checking with interactive funding prompts
- System requirements validation
- Keystore management with Reynolds format addresses
- Singleton Polkadot.js API connection
- GitHub Actions CI/CD pipeline for automated builds
- Tag-based release automation

### Technical Details
- Built with Deno and Cliffy CLI framework
- TypeScript with strict type checking
- Polkadot.js integration for blockchain interaction
- Systematic error handling and user feedback
- Compressed binary distribution for faster downloads

## [1.0.0] - TBD

### Added
- First stable release
- Production-ready node management capabilities
- Complete documentation and troubleshooting guides