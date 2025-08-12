#!/usr/bin/env node

/**
 * Orca AI MCP Server
 * 
 * This is a Model Context Protocol (MCP) server that provides integration with Orca AI's API.
 * It supports dynamic configuration detection and provides tools for security analysis and HUNT searches.
 * 
 * The server can be configured via local .orcaai.json files or environment variables,
 * allowing for project-specific configurations while maintaining flexibility.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

/**
 * Configuration schema for Orca AI API integration
 * 
 * Defines the structure and validation rules for Orca AI configuration.
 * Supports both local file-based configuration (.orcaai.json) and environment variables.
 */
const OrcaConfigSchema = z.object({
  // Base API URL for Orca AI services
  apiUrl: z.string().default("https://api.orcaai.io"),
  
  // API key for authentication (required - 40 alphanumeric characters)
  apiToken: z.string().length(40).regex(/^[a-zA-Z0-9]+$/),
  
  // Connection and retry settings
  settings: z.object({
    timeout: z.number().default(30000),    // Request timeout in milliseconds
    retries: z.number().default(3),        // Number of retry attempts for failed requests
  }).optional(),
  
  // Tool availability flags - allows selective enabling/disabling of features
  tools: z.object({
    hunt: z.boolean().default(true),       // HUNT search functionality across datasets
  }).optional(),
});

// TypeScript type derived from the Zod schema
type OrcaConfig = z.infer<typeof OrcaConfigSchema>;

/**
 * Argument schema for the detect_orca_context tool
 * (No parameters expected)
 */
const DetectContextArgsSchema = z.object({});

/**
 * Argument schema for the get_hunt_results tool
 */
const HuntArgsSchema = z.object({
  query: z.string().min(1),              // Required non-empty search query
  nextToken: z.string().optional(),      // Optional pagination token
});

/**
 * Main MCP server class that handles Orca AI API integration
 * 
 * This class provides a Model Context Protocol server that dynamically detects
 * configuration and exposes tools for interacting with Orca AI's security platform.
 */
export class OrcaAIMCPProxy {
  private server: Server;                    // MCP server instance
  private config: OrcaConfig | null = null;  // Current configuration (loaded dynamically)
  private axiosInstance: AxiosInstance;      // HTTP client for API requests

  /**
   * Initialize the MCP server with basic capabilities
   * Sets up the server identity and prepares for tool registration
   */
  constructor() {
    // Create MCP server with identification
    this.server = new Server(
      {
        name: "orca-ai-mcp",
        version: "1.0.0",
        protocolVersion: "2024-11-05",
      },
      {
        capabilities: {
          tools: {},  // We'll register tools dynamically based on configuration
        },
      }
    );

    // Initialize HTTP client (will be reconfigured when config is detected)
    this.axiosInstance = axios.create();
    
    // Set up request handlers for MCP protocol
    this.setupHandlers();
  }

  /**
   * Detect and load Orca AI configuration from local files or environment variables
   * 
   * This method implements a hierarchical configuration detection strategy:
   * 1. First, look for .orcaai.json in the current working directory (project-specific)
   * 2. Fall back to environment variables (system-wide configuration)
   * 
   * @returns Validated configuration object or null if configuration is invalid/missing
   */
  private detectConfig(): OrcaConfig | null {
    try {
      // Priority 1: Local configuration file (.orcaai.json in current directory)
      const localConfigPath = path.join(process.cwd(), '.orcaai.json');
      if (fs.existsSync(localConfigPath)) {
        const configContent = fs.readFileSync(localConfigPath, 'utf-8');
        const config = JSON.parse(configContent);
        return OrcaConfigSchema.parse(config);  // Validate against schema
      }

      // Priority 2: Environment variables (fallback for containerized deployments)
      const envConfig = {
        apiUrl: process.env.ORCA_API_URL || "https://api.orcaai.io",
        apiToken: process.env.ORCA_API_TOKEN || "",
        settings: {
          timeout: parseInt(process.env.ORCA_TIMEOUT || "30000", 10),
          retries: parseInt(process.env.ORCA_RETRIES || "3", 10),
        },
        // Tool enablement flags (default to enabled unless explicitly disabled)
        tools: {
          hunt: process.env.ORCA_TOOLS_HUNT !== "false",
        }
      };

      // API token is required for any configuration to be valid
      if (!envConfig.apiToken) {
        throw new Error("No API token found in config file or environment variables");
      }

      return OrcaConfigSchema.parse(envConfig);  // Validate against schema
    } catch (error) {
      console.error("Configuration error:", error);
      return null;  // Return null to indicate configuration detection failed
    }
  }

  /**
   * Configure HTTP client (Axios) with authentication and retry logic
   * 
   * Sets up the HTTP client with proper headers, timeouts, and automated retry
   * functionality for resilient API communication with Orca AI services.
   * 
   * @param config Validated Orca AI configuration object
   */
  private setupAxiosInstance(config: OrcaConfig) {
    // Create configured HTTP client instance
    this.axiosInstance = axios.create({
      baseURL: config.apiUrl,                                    // Base URL for all API requests
      timeout: config.settings?.timeout ?? 30000,               // Request timeout (30s default)
      headers: {
        'x-api-key': config.apiToken,                           // Orca AI API authentication key
        'Content-Type': 'application/json',                     // JSON content type for requests
      },
    });

    // Configure automatic retry logic for resilient API communication
    this.axiosInstance.interceptors.response.use(
      // Success handler - pass through successful responses
      (response) => response,
      
      // Error handler - implement exponential backoff retry for server errors
      async (error) => {
        const config = error.config;
        
        // Initialize retry counter if not present
        if (!config || !config.retry) {
          config.retry = 0;
        }

        const maxRetries = this.config?.settings?.retries ?? 3;
        
        // Retry on server errors (5xx status codes) with exponential backoff
        if (config.retry < maxRetries && error.response?.status >= 500) {
          config.retry += 1;
          
          // Exponential backoff: wait 1s, 2s, 3s, etc. between retries
          await new Promise(resolve => setTimeout(resolve, 1000 * config.retry));
          
          // Retry the request
          return this.axiosInstance(config);
        }

        // Max retries reached or non-retriable error - propagate the error
        return Promise.reject(error);
      }
    );
  }

  /**
   * Set up MCP protocol request handlers
   * 
   * Configures handlers for the Model Context Protocol, including:
   * - ListTools: Dynamic tool registration based on configuration
   * - CallTool: Execution of registered tools with error handling
   */
  private setupHandlers() {
    // Handle initialization requests (required for Gemini CLI compatibility)
    this.server.setRequestHandler(InitializeRequestSchema, async () => {
      return {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "orca-ai-mcp",
          version: "1.0.0",
        },
      };
    });

    // Handle requests for available tools list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Attempt to detect configuration on each tools request
      const config = this.detectConfig();
      
      // If no valid configuration is found, only provide the context detection tool
      if (!config) {
        return {
          tools: [
            {
              name: "detect_orca_context",
              title: "Detect Orca Context",
              description: "Detect current Orca AI configuration and context",
              instructions: "Use this tool without parameters to check if Orca AI is configured properly, including API URL, timeouts, retries, and enabled features like HUNT search.",
              inputSchema: {
                type: "object",
                properties: {}
              }
            },
          ],
        };
      }

      // Valid configuration found - set up HTTP client and register full tool set
      this.config = config;
      this.setupAxiosInstance(config);

      // Base tools always available
      const detectProperties = {} as const;
      const tools = [
        {
          name: "detect_orca_context",
          title: "Detect Orca Context",
          description: "Detect current Orca AI configuration and context",
          instructions: "Use this tool without parameters to check if Orca AI is configured properly, including API URL, timeouts, retries, and enabled features like HUNT search.",
          inputSchema: {
            type: "object",
            properties: detectProperties,
            additionalProperties: false,
            required: [] as string[]
          },
          outputSchema: {
            type: "object",
            properties: {
              text: { type: "string" }
            },
            required: ["text"]
          }
        },
      ];

      // Conditionally add tools based on configuration flags
      if (config.tools?.hunt ?? true) {
        const huntProperties = {
          query: { type: "string", description: "The search query (person name, company, etc.)" } as const,
          nextToken: { type: "string", description: "Pagination token for next page" } as const,
        };
        tools.push(
          {
            name: "get_hunt_results",
            title: "Get HUNT Results",
            description: "Search across datasets using Orca AI's HUNT API for people, companies, and entities",
            instructions: "Provide a 'query' string (required) for the search term. Optionally include 'nextToken' string for pagination. Example arguments: {'query': 'example company'}.",
            inputSchema: {
              type: "object",
              properties: huntProperties,
              required: ["query"] as string[],
              additionalProperties: false
            },
            outputSchema: {
              "$schema": "http://json-schema.org/draft-07/schema#",
              "type": "object",
              "properties": {
                "query": {
                  "type": "string"
                },
                "nextToken": {
                  "type": "string",
                  "description": "Encrypted token for next page, null if no more results"
                },
                "huntDocuments": {
                  "type": "array",
                  "maxItems": 100,
                  "items": {
                    "type": "object",
                    "properties": {
                      "datasetId": {
                        "type": "string"
                      },
                      "id": {
                        "type": "string"
                      },
                      "names": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      },
                      "primaryName": {
                        "type": "string"
                      },
                      "rawData": {
                        "type": "string"
                      },
                      "values": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      },
                      "dataset": {
                        "type": "object",
                        "properties": {
                          "authorities": {
                            "type": "array",
                            "items": {
                              "type": "string"
                            }
                          },
                          "section": {
                            "type": "string"
                          },
                          "exactListName": {
                            "type": "string"
                          },
                          "implementingOrganization": {
                            "type": "string"
                          }
                        },
                        "required": [
                          "authorities",
                          "section",
                          "exactListName",
                          "implementingOrganization"
                        ]
                      },
                      "tabularData": {
                        "type": "object",
                        "properties": {
                          "headers": {
                            "type": "array",
                            "items": {
                              "type": "string"
                            }
                          },
                          "fields": {
                            "type": "array",
                            "items": {
                              "type": "string"
                            }
                          }
                        },
                        "required": [
                          "headers",
                          "fields"
                        ]
                      }
                    },
                    "required": [
                      "datasetId",
                      "id",
                      "names",
                      "primaryName",
                      "rawData",
                      "values",
                      "dataset",
                      "tabularData"
                    ]
                  }
                }
              },
              "required": [
                "query",
                "nextToken",
                "huntDocuments"
              ],
              "additionalProperties": false
            }
          } as any
        );
      }

      return { tools };
    });

    // Handle tool execution requests
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Reload config for safety in case ListTools wasn't called first
      if (!this.config) {
        this.config = this.detectConfig();
        if (this.config) {
          this.setupAxiosInstance(this.config);
        }
      }

      try {
        // Route tool calls to appropriate handler methods
        switch (name) {
          case "detect_orca_context":
            DetectContextArgsSchema.parse(args); // Enforce no args
            return await this.handleDetectContext();
            
          case "get_hunt_results":
            if (!this.config) {
              throw new Error("Configuration not loaded. Run detect_orca_context first.");
            }
            const parsedArgs = HuntArgsSchema.parse(args);
            return await this.handleGetHuntResults(parsedArgs);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        // Comprehensive error handling with logging
        console.error(`Error executing ${name}:`, error);
        let errorMessage = 'Unknown error occurred';
        if (error instanceof z.ZodError) {
          errorMessage = `Invalid arguments: ${error.errors.map(e => e.message).join(', ')}`;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
        };
      }
    });
  }

  /**
   * Handle context detection tool execution
   * 
   * Provides information about the current configuration state, including
   * API connectivity and available tools. Useful for debugging and setup verification.
   * 
   * @returns MCP response with configuration details or error message
   */
  private async handleDetectContext() {
    const config = this.detectConfig();
    
    if (!config) {
      return {
        content: [
          {
            type: "text",
            text: `❌ No Orca AI configuration found!\n\nPlease create a '.orcaai.json' file in your current directory or set the required environment variables:\n\nRequired:\n- ORCA_API_TOKEN: Your Orca AI API key (40 alphanumeric characters)\n\nOptional:\n- ORCA_API_URL: Orca API URL (default: https://api.orcaai.io)\n- ORCA_TIMEOUT: Request timeout in milliseconds (default: 30000)\n- ORCA_RETRIES: Number of retries (default: 3)`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `✅ Orca AI Configuration Detected!\n\nAPI URL: ${config.apiUrl}\nTimeout: ${config.settings?.timeout ?? 30000}ms\nRetries: ${config.settings?.retries ?? 3}\n\nEnabled Tools:\n- HUNT Search: ${config.tools?.hunt ?? true ? '✅' : '❌'}`,
        },
      ],
    };
  }

  /**
   * Handle HUNT results retrieval from Orca AI
   * 
   * Executes security searches using Orca AI's HUNT API. The HUNT API allows searching
   * across various datasets for entities like people, companies, and other relevant information.
   * Uses the v0.2 API endpoint which supports pagination for large result sets.
   * 
   * @param args Validated tool arguments containing search parameters
   * @returns MCP response with HUNT search results in JSON format
   */
  private async handleGetHuntResults(args: z.infer<typeof HuntArgsSchema>) {
    // Build request payload for HUNT API
    const requestData: any = {
      query: args.query  // Search query string (required)
    };

    const apiVersion = 'v0.2';
    const endpoint = `/${apiVersion}/hunt`;

    if (args.nextToken) {
      requestData.nextToken = args.nextToken;
    }

    try {
      // Execute POST request to HUNT API endpoint
      const response = await this.axiosInstance.post(endpoint, requestData);
      
      // Extract results from response
      const huntData = response.data;
      const resultCount = huntData.huntDocuments ? huntData.huntDocuments.length : 0;
      
      // Format pagination information
      let paginationInfo = '';
      if (huntData.nextToken) {
        paginationInfo = `\n\n📄 More results available. Use nextToken: "${huntData.nextToken}" to retrieve the next page.`;
      }

      // Format response for MCP client consumption with structured information
      let formattedOutput = `🔍 HUNT Search Results for "${huntData.query}"\n`;
      formattedOutput += `📊 Found ${resultCount} records using API ${apiVersion}\n`;
      
      if (paginationInfo) {
        formattedOutput += paginationInfo;
      }

      // Format hunt documents with key information highlighted
      if (huntData.huntDocuments && huntData.huntDocuments.length > 0) {
        formattedOutput += '\n\n📋 Records Found:\n';
        formattedOutput += '═'.repeat(50) + '\n';
        
        huntData.huntDocuments.forEach((doc: any, index: number) => {
          formattedOutput += `\n🔸 Record ${index + 1}:\n`;
          
          // Primary identification
          if (doc.primaryName) {
            formattedOutput += `   Primary Name: ${doc.primaryName}\n`;
          }
          
          // Alternative names
          if (doc.names && doc.names.length > 0) {
            formattedOutput += `   Known Names: ${doc.names.join(', ')}\n`;
          }
          
          // Dataset information
          if (doc.dataset) {
            formattedOutput += `   Source Dataset: ${doc.dataset.exactListName || doc.dataset.section || 'Unknown'}\n`;
            if (doc.dataset.authorities && doc.dataset.authorities.length > 0) {
              formattedOutput += `   Authorities: ${doc.dataset.authorities.join(', ')}\n`;
            }
          }
          
          // Raw data summary (truncated for readability)
          if (doc.rawData) {
            const rawDataPreview = doc.rawData.length > 200 
              ? doc.rawData.substring(0, 200) + '...' 
              : doc.rawData;
            formattedOutput += `   Details: ${rawDataPreview}\n`;
          }
          
          // Key values
          if (doc.values && doc.values.length > 0) {
            formattedOutput += `   Key Values: ${doc.values.join(', ')}\n`;
          }
          
          // Tabular data summary
          if (doc.tabularData && doc.tabularData.headers) {
            formattedOutput += `   Structured Data: ${doc.tabularData.headers.length} fields available\n`;
          }
          
          if (index < huntData.huntDocuments.length - 1) {
            formattedOutput += '   ' + '-'.repeat(40) + '\n';
          }
        });
        
        // Add complete JSON for detailed analysis
        formattedOutput += '\n\n📄 Complete Data (JSON):\n';
        formattedOutput += '═'.repeat(50) + '\n';
        formattedOutput += JSON.stringify(huntData, null, 2);
      } else {
        formattedOutput += '\n\n❌ No records found for this search query.';
      }

      return {
        content: [
          {
            type: "text",
            text: formattedOutput,
          },
        ],
      };
    } catch (error: any) {
      // Handle API-specific errors with helpful messages
      if (error.response?.status === 401) {
        throw new Error("Authentication failed. Please verify your API key is correct and has proper permissions.");
      } else if (error.response?.status === 400) {
        throw new Error(`Invalid request: ${error.response.data?.message || 'Bad request parameters'}`);
      } else if (error.response?.status === 429) {
        throw new Error("Rate limit exceeded. Please wait before making another request.");
      } else {
        throw new Error(`HUNT API error: ${error.message}`);
      }
    }
  }

  /**
   * Start the MCP server and begin listening for requests
   * 
   * Initializes the stdio transport layer and connects the server to handle
   * incoming MCP protocol messages. The server communicates via stdin/stdout.
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Orca AI MCP Server running on stdio");  // Log to stderr to avoid protocol interference
  }
}

/**
 * Application entry point
 * 
 * Creates and starts the Orca AI MCP server instance. Handles any startup
 * errors gracefully with proper logging and exit codes.
 */
async function main() {
  const server = new OrcaAIMCPProxy();
  await server.run();
}

// Only run if this file is executed directly (not imported as a module)
if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);  // Exit with error code to indicate failure
  });
}