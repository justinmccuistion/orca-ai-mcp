import { OrcaAIMCPProxy } from '../../src/OrcaAIMCPProxy';
import * as fs from 'fs';

jest.mock('@modelcontextprotocol/sdk');
jest.mock('fs');

describe('OrcaAIMCPProxy', () => {
  let server: OrcaAIMCPProxy;
  const mockedFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    server = new OrcaAIMCPProxy();
    // Mock fs.existsSync to return false so it doesn't find config files
    mockedFs.existsSync = jest.fn().mockReturnValue(false);
  });

  describe('detectConfig', () => {
    beforeEach(() => {
      // Clear all Orca environment variables before each test
      delete process.env.ORCA_API_URL;
      delete process.env.ORCA_API_TOKEN;
      delete process.env.ORCA_TIMEOUT;
      delete process.env.ORCA_RETRIES;
      delete process.env.ORCA_TOOLS_HUNT;
    });

    it('should load config from environment variables', () => {
      // Set up clean test environment
      process.env.ORCA_API_URL = 'https://api.test.com';
      process.env.ORCA_API_TOKEN = '1234567890123456789012345678901234567890'; // 40 chars
      process.env.ORCA_TIMEOUT = '15000';
      process.env.ORCA_RETRIES = '5';

      const detectedConfig = server['detectConfig']();
      expect(detectedConfig).toEqual(expect.objectContaining({
        apiUrl: 'https://api.test.com',
        apiToken: '1234567890123456789012345678901234567890',
        settings: expect.objectContaining({
          timeout: 15000,
          retries: 5
        })
      }));
    });

    it('should return null when no valid configuration is found', () => {
      // Ensure no environment variables are set
      const detectedConfig = server['detectConfig']();
      expect(detectedConfig).toBeNull();
    });
  });
});