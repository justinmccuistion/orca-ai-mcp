# Orca AI MCP Server

A Model Context Protocol (MCP) server that integrates with Orca AI's HUNT Platform API for finding information about people, companies, and other entities.

## Features

- **Dynamic Configuration**: Directory-based configuration using local `.orcaai.json` files
- **HUNT API Integration**: Search across authoritative datasets for people, companies, and entities  
- **Flexible Authentication**: API key-based authentication with environment variable fallback
- **Context-Aware**: Automatically detects and switches between different configurations
- **Robust Error Handling**: Built-in retry logic with exponential backoff

## Installation

### Claude Code MCP

Add to your `~/.config/claude-code/mcp_servers.json`:

```json
{
  "mcpServers": {
    "orca-ai": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "ORCA_API_TOKEN": "your-orca-ai-api-key"
      }
    }
  }
}
```

### Gemini CLI

Add to your `~/.gemini/settings.json` or project `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "orca-ai-mcp": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "ORCA_API_TOKEN": "your-orca-ai-api-key"
      },
      "timeout": 30000,
      "trust": false,
      "includeTools": ["detect_orca_context", "get_hunt_results"]
    }
  }
}
```

### Development Setup

```bash
cd orca-ai-mcp
npm install
npm run build
```

## Configuration

### Local Configuration (Recommended)

Create a `.orcaai.json` file in your working directory:

```json
{
  "apiUrl": "https://api.orcaai.io",
  "apiToken": "your-orca-ai-api-key-here",
  "settings": {
    "timeout": 30000,
    "retries": 3
  },
  "tools": {
    "hunt": true
  }
}
```

### Environment Variables

Alternatively, use environment variables:

```bash
export ORCA_API_TOKEN="your-orca-ai-api-key"
export ORCA_API_URL="https://api.orcaai.io"
export ORCA_TIMEOUT="30000"
export ORCA_RETRIES="3"
export ORCA_TOOLS_HUNT="true"
```

## Available Tools

### HUNT Search
- `get_hunt_results`: Search across datasets for people, companies, and entities
  - **Required**: `query` - Search string (person name, company name, etc.)
  - **Optional**: `nextToken` - Pagination token for subsequent pages (v0.2 API)

### Context Detection
- `detect_orca_context`: Detect current configuration and verify API connectivity

## Authentication

This MCP server requires an Orca AI API key:

1. **API Key Format**: 40 alphanumeric characters
2. **Header Used**: `x-api-key`
3. **Endpoint**: `https://api.orcaai.io`

## API Endpoints Used

- **v0.2 HUNT API**: `POST /v0.2/hunt` (default, supports pagination, max 100 results per page)

## Usage Examples

### Basic Person Search

```typescript
// Search for a person
const results = await callTool("get_hunt_results", {
  query: "Vladimir Putin"
});
```

### Company Search

```typescript
// Search for a company
const results = await callTool("get_hunt_results", {
  query: "Microsoft Corporation"
});
```

### Paginated Search

```typescript
// Get first page
const page1 = await callTool("get_hunt_results", {
  query: "John Smith"
});

// Get next page using returned token
const page2 = await callTool("get_hunt_results", {
  query: "John Smith",
  nextToken: "returned-token-from-page1"
});
```

### Configuration Check

```typescript
// Verify your configuration
const context = await callTool("detect_orca_context");
```

## Response Format

HUNT search results include:

- **query**: Original search query
- **nextToken**: Pagination token (v0.2 only)
- **huntDocuments**: Array of matching records containing:
  - `primaryName`: Main identified name
  - `names`: Array of alternative names
  - `dataset`: Source dataset information
  - `rawData`: Unstructured text about the record
  - `values`: Array of relevant values/attributes
  - `tabularData`: Structured data fields

## Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the project  
- `npm run start` - Start the built server
- `npm run test` - Run tests
- `npm run type-check` - Check TypeScript types
- `npm run clean` - Clean build directory

### Testing the Server

```bash
# Build and start the server
npm run build
npm start

# In another terminal, test with Claude Code
# The server runs on stdio and communicates via MCP protocol
```

## How to Start and Use

### Step 1: Configure Your API Key

```bash
# Copy the example configuration
cp .orcaai.json.example .orcaai.json

# Edit .orcaai.json and add your API key
```

### Step 2: Build the Server

```bash
npm run build
```

### Step 3: Configure Claude Code

Add the server to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "orca-ai": {
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

### Step 4: Restart Claude Code

Restart Claude Code to load the MCP server.

### Step 5: Use the Tools

Ask Claude Code to:
- "Search for information about [person/company] using Orca AI"
- "Check my Orca AI configuration"
- "Search the HUNT platform for [query]"

## Error Handling

The server handles common API errors:

- **401 Unauthorized**: Invalid or missing API key
- **400 Bad Request**: Invalid query parameters  
- **429 Rate Limited**: Too many requests
- **5xx Server Errors**: Automatic retry with exponential backoff

## Directory Structure

```
orca-ai-mcp/
├── src/
│   └── index.ts           # Main MCP server implementation
├── dist/                  # Built JavaScript files
├── tests/                 # Test files
├── .orcaai.json.example   # Configuration example
├── .orcaai.json          # Your actual config (gitignored)
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md            # This file
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper comments
4. Ensure the build passes: `npm run build`
5. Test your changes
6. Submit a pull request

## License

MIT License

## Support

For issues and questions:
- Check the [Orca AI API documentation](https://api.orcaai.io/ApiReference)
- Create an issue on GitHub
- Review existing issues for similar problems

## Troubleshooting

### Common Issues

1. **"No configuration found"**
   - Ensure `.orcaai.json` exists with valid API key
   - Check environment variables are set correctly

2. **"Authentication failed"** 
   - Verify your API key is 40 characters and valid
   - Ensure no extra spaces in configuration

3. **"Rate limit exceeded"**
   - Wait before making another request
   - Consider implementing delays between requests

4. **Server not starting**
   - Run `npm run build` first
   - Check Node.js version (requires 18+)
   - Verify all dependencies installed: `npm install`