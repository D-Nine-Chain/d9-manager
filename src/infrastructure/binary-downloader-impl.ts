/**
 * Concrete implementation of BinaryDownloader.
 *
 * Infrastructure layer - handles file downloads and verification.
 */

import { BinaryDownloader } from '../services/node-setup-service.ts';
import { executeCommand } from '../utils/system.ts';

/**
 * Wget-based binary downloader implementation
 */
export class WgetBinaryDownloader implements BinaryDownloader {
  async download(url: string, destination: string): Promise<void> {
    console.log(`📥 Downloading ${url.split('/').pop()}`);

    const result = await executeCommand('wget', ['-O', destination, url]);

    if (!result.success) {
      throw new Error(`Download failed: ${result.error}`);
    }

    console.log('✅ Download complete');
  }

  async verify(path: string, expectedHash?: string): Promise<boolean> {
    if (!expectedHash) {
      console.log('⚠️  No hash provided, skipping verification');
      return true;
    }

    console.log('🔐 Verifying file integrity...');

    const result = await executeCommand('sha256sum', [path]);

    if (!result.success) {
      throw new Error('Failed to calculate file hash');
    }

    const actualHash = result.output.trim().split(/\s+/)[0];

    if (actualHash === expectedHash) {
      console.log('✅ File integrity verified');
      return true;
    } else {
      console.error('❌ File integrity check failed');
      console.error(`   Expected: ${expectedHash}`);
      console.error(`   Got:      ${actualHash}`);
      return false;
    }
  }
}

/**
 * GitHub release downloader - downloads from GitHub releases
 */
export class GitHubReleaseBinaryDownloader implements BinaryDownloader {
  constructor(
    private readonly repo: string, // e.g. "D-Nine-Chain/d9-node"
    private readonly wgetDownloader: WgetBinaryDownloader = new WgetBinaryDownloader()
  ) {}

  async download(destination: string): Promise<void> {
    // Fetch latest release info
    console.log('🌐 Fetching latest release information...');

    const releaseResult = await executeCommand('curl', [
      '-s',
      `https://api.github.com/repos/${this.repo}/releases/latest`,
    ]);

    if (!releaseResult.success) {
      throw new Error('Failed to fetch release information');
    }

    const release = JSON.parse(releaseResult.output);

    // Check for rate limit
    if (release.message && release.message.includes('rate limit')) {
      throw new Error('GitHub API rate limit exceeded. Try again later.');
    }

    // Find tarball asset
    const tarballAsset = release.assets?.find((asset: any) =>
      asset.name.endsWith('.tar.gz')
    );

    if (!tarballAsset) {
      throw new Error('Could not find tarball in release assets');
    }

    // Download using wget
    await this.wgetDownloader.download(tarballAsset.browser_download_url, destination);
  }

  async verify(path: string, expectedHash?: string): Promise<boolean> {
    return await this.wgetDownloader.verify(path, expectedHash);
  }
}
