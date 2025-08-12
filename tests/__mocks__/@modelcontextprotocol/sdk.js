module.exports = {
  Server: jest.fn().mockImplementation(() => {
    return {
      setRequestHandler: jest.fn(),
      connect: jest.fn(),
    };
  }),
  StdioServerTransport: jest.fn(),
  CallToolRequestSchema: {},
  ListToolsRequestSchema: {},
};
