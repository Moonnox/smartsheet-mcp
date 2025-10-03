#!/usr/bin/env node

/**
 * Remote MCP Server for Smartsheet
 * A remote MCP server that exposes Smartsheet functionality via HTTP
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { SmartsheetAPI } from './apis/smartsheet-api.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDiscussionTools } from './tools/smartsheet-discussion-tools.js';
import { getFolderTools } from './tools/smartsheet-folder-tools.js';
import { getSearchTools } from './tools/smartsheet-search-tools.js';
import { getSheetTools } from './tools/smartsheet-sheet-tools.js';
import { getUpdateRequestTools } from './tools/smartsheet-update-request-tools.js';
import { getUserTools } from './tools/smartsheet-user-tools.js';
import { getWorkspaceTools } from './tools/smartsheet-workspace-tools.js';
import packageJson from '../package.json' with { type: 'json' };

// Load environment variables
config();

// Configuration from environment variables
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== 'false'; // Default to true
const SECRET_KEY = process.env.SECRET_KEY || '';

// Logging utility
const logger = {
  info: (message: string, ...args: any[]) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
  },
  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
  },
  warning: (message: string, ...args: any[]) => {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
  },
  debug: (message: string, ...args: any[]) => {
    if (process.env.DEBUG === 'true') {
      console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
    }
  }
};

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Authentication middleware
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip auth if not required (for local development)
  if (!REQUIRE_AUTH) {
    return next();
  }

  // Skip auth if SECRET_KEY is not configured
  if (!SECRET_KEY) {
    logger.warning('SECRET_KEY not configured but REQUIRE_AUTH is true');
    return next();
  }

  // Only check auth for /mcp endpoint with POST method
  if (req.path === '/mcp' && req.method === 'POST') {
    try {
      const body = req.body;
      const method = body?.method;

      // Only require auth for tools/call
      if (method === 'tools/call') {
        const providedKey = req.headers['x-secret-key'] as string;

        if (!providedKey) {
          const clientHost = req.ip || 'unknown';
          logger.warning(`Missing x-secret-key header from ${clientHost} for tools/call`);
          return res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Authentication required for tool execution'
            },
            id: body?.id
          });
        }

        if (providedKey !== SECRET_KEY) {
          const clientHost = req.ip || 'unknown';
          logger.warning(`Invalid x-secret-key from ${clientHost} for tools/call`);
          return res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Invalid authentication for tool execution'
            },
            id: body?.id
          });
        }
      }

      // For discovery methods (initialize, tools/list), allow without auth
      else if (method === 'initialize' || method === 'tools/list') {
        logger.debug(`Allowing unauthenticated ${method} request`);
      }
    } catch (e) {
      logger.error('Error in auth middleware:', e);
      // On error, let the request through to be handled properly
    }
  }

  next();
};

app.use(authMiddleware);

// Tool handler map - stores API instances per request
const apiInstances: Map<string, SmartsheetAPI> = new Map();

// Function to get or create an API instance for a request
function getApiInstance(apiKey: string, apiEndpoint?: string): SmartsheetAPI {
  const key = `${apiKey}:${apiEndpoint || 'default'}`;
  let api = apiInstances.get(key);
  
  if (!api) {
    api = new SmartsheetAPI(apiKey, apiEndpoint || 'https://api.smartsheet.com/2.0', true);
    apiInstances.set(key, api);
    
    // Clean up old instances to prevent memory leaks
    if (apiInstances.size > 100) {
      const firstKey = apiInstances.keys().next().value;
      if (firstKey) {
        apiInstances.delete(firstKey);
      }
    }
  }
  
  return api;
}

// Create tool definitions by executing tool registration with a dummy server
function getToolDefinitions(allowDeleteTools: boolean = false): Array<{ name: string; description: string; inputSchema: any }> {
  const dummyApi = new SmartsheetAPI('', '', true);
  const tempServer = new McpServer({
    name: 'smartsheet',
    version: packageJson.version,
  });

  const tools: Array<{ name: string; description: string; inputSchema: any }> = [];

  // Intercept tool registration to capture definitions
  const originalToolMethod = tempServer.tool.bind(tempServer);
  (tempServer as any).tool = function(name: string, description: string, schemaOrHandler: any, handler?: any) {
    let inputSchema: any = {};

    // If handler is provided separately, first arg is schema
    if (handler !== undefined) {
      inputSchema = schemaOrHandler;
    }

    // Convert Zod schema to JSON Schema format
    if (inputSchema && typeof inputSchema === 'object' && !Array.isArray(inputSchema)) {
      const properties: any = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(inputSchema)) {
        if (value && typeof value === 'object' && 'description' in value) {
          properties[key] = {
            type: 'string', // simplified - would need proper Zod to JSON Schema conversion
            description: (value as any).description
          };
          required.push(key);
        }
      }

      inputSchema = {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined
      };
    } else if (Object.keys(inputSchema).length === 0) {
      inputSchema = {
        type: 'object',
        properties: {}
      };
    }

    tools.push({ name, description, inputSchema });

    // Don't actually call the original - we just want definitions
    return tempServer;
  };

  // Register all tools to get their definitions
  getDiscussionTools(tempServer, dummyApi);
  getFolderTools(tempServer, dummyApi);
  getSearchTools(tempServer, dummyApi);
  getSheetTools(tempServer, dummyApi, allowDeleteTools);
  getUpdateRequestTools(tempServer, dummyApi);
  getUserTools(tempServer, dummyApi);
  getWorkspaceTools(tempServer, dummyApi);

  return tools;
}

// Get a server instance with tools registered for actual execution
async function executeToolCall(apiKey: string, apiEndpoint: string | undefined, allowDeleteTools: boolean, toolName: string, toolArguments: any): Promise<any> {
  const api = getApiInstance(apiKey, apiEndpoint);
  const tempServer = new McpServer({
    name: 'smartsheet',
    version: packageJson.version,
  });

  // Track if tool was found and executed
  let toolFound = false;
  let toolResult: any = null;

  // Intercept tool calls
  const originalToolMethod = tempServer.tool.bind(tempServer);
  (tempServer as any).tool = function(name: string, description: string, schemaOrHandler: any, handler?: any) {
    const actualHandler = handler !== undefined ? handler : schemaOrHandler;

    // If this is the tool we're looking for, execute it
    if (name === toolName) {
      toolFound = true;
      toolResult = actualHandler(toolArguments);
    }

    // Return the server for chaining
    return tempServer;
  };

  // Register all tools
  getDiscussionTools(tempServer, api);
  getFolderTools(tempServer, api);
  getSearchTools(tempServer, api);
  getSheetTools(tempServer, api, allowDeleteTools);
  getUpdateRequestTools(tempServer, api);
  getUserTools(tempServer, api);
  getWorkspaceTools(tempServer, api);

  if (!toolFound) {
    throw new Error(`Tool not found: ${toolName}`);
  }

  return await toolResult;
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'mcp-smartsheet',
    version: packageJson.version
  });
});

// Root endpoint with server information
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'MCP Smartsheet Server',
    version: packageJson.version,
    description: 'Model Context Protocol server for Smartsheet API',
    endpoints: {
      '/health': 'Health check endpoint',
      '/mcp': 'MCP JSON-RPC endpoint',
      '/tools': 'List available tools'
    },
    documentation: 'https://github.com/smartsheet-platform/smar-mcp'
  });
});

// List tools endpoint (for discovery without auth)
app.get('/tools', async (req: Request, res: Response) => {
  try {
    const tools = getToolDefinitions(false);
    res.json({ tools });
  } catch (error: any) {
    logger.error('Error listing tools:', error);
    res.status(500).json({
      error: 'Failed to list tools',
      message: error.message
    });
  }
});

// Main MCP endpoint for handling JSON-RPC requests
app.post('/mcp', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Log the incoming request for debugging
    logger.debug(`Received MCP request: ${JSON.stringify(body)}`);

    // Validate JSON-RPC structure
    if (!body || typeof body !== 'object') {
      return res.json({
        jsonrpc: '2.0',
        error: {
          code: -32700,
          message: 'Parse error: Invalid JSON'
        },
        id: null
      });
    }

    const method = body.method;
    const params = body.params || {};
    const requestId = body.id;

    // Route to appropriate handler based on method
    if (method === 'initialize') {
      const result = {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          prompts: null,
          resources: null
        },
        serverInfo: {
          name: 'smartsheet',
          version: packageJson.version
        }
      };

      return res.json({
        jsonrpc: '2.0',
        result,
        id: requestId
      });
    } else if (method === 'tools/list') {
      const allowDeleteTools = req.headers['x-allow-delete-tools'] === 'true';
      const tools = getToolDefinitions(allowDeleteTools);

      return res.json({
        jsonrpc: '2.0',
        result: {
          tools
        },
        id: requestId
      });
    } else if (method === 'tools/call') {
      // Extract Smartsheet API credentials from headers
      const apiKey = req.headers['x-smartsheet-api-key'] as string;
      const apiEndpoint = req.headers['x-smartsheet-endpoint'] as string;
      const allowDeleteTools = req.headers['x-allow-delete-tools'] === 'true';

      // Validate required headers
      if (!apiKey) {
        return res.json({
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: 'Missing required header: x-smartsheet-api-key'
          },
          id: requestId
        });
      }

      const toolName = params.name;
      const toolArguments = params.arguments || {};

      try {
        // Execute the tool call
        const result = await executeToolCall(apiKey, apiEndpoint, allowDeleteTools, toolName, toolArguments);

        return res.json({
          jsonrpc: '2.0',
          result,
          id: requestId
        });
      } catch (error: any) {
        logger.error(`Error calling tool ${toolName}:`, error);
        return res.json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: `Tool execution error: ${error.message}`
          },
          id: requestId
        });
      }
    } else {
      // Method not found
      return res.json({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        },
        id: requestId
      });
    }
  } catch (error: any) {
    logger.error('Error handling MCP request:', error);
    return res.json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: `Internal error: ${error.message}`
      },
      id: req.body?.id || null
    });
  }
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} not found`,
    availableEndpoints: ['/', '/health', '/tools', '/mcp']
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start the server
app.listen(PORT, HOST, () => {
  logger.info(`Starting MCP Smartsheet Server on ${HOST}:${PORT}`);
  logger.info(`Authentication enabled: ${REQUIRE_AUTH}`);
  logger.info(`Secret Key configured: ${SECRET_KEY ? 'Yes' : 'No'}`);
  logger.info(`Server ready to accept connections`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  process.exit(0);
});

