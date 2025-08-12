import { OrcaAIMCPProxy } from '../../src/OrcaAIMCPProxy';

jest.mock('@modelcontextprotocol/sdk');

describe('OrcaAIMCPProxy', () => {
  let server: OrcaAIMCPProxy;

  beforeEach(() => {
    server = new OrcaAIMCPProxy();
  });

  describe('detectConfig', () => {
    it('should load config from environment variables', () => {
      process.env.ORCA_API_URL = 'https://api.test.com';
      process.env.ORCA_API_TOKEN = 'test-token';

      const detectedConfig = server['detectConfig']();
      expect(detectedConfig).toEqual(expect.objectContaining({
        apiUrl: 'https://api.test.com',
        apiToken: 'test-token',
      }));

      delete process.env.ORCA_API_URL;
      delete process.env.ORCA_API_TOKEN;
    });
  });
});