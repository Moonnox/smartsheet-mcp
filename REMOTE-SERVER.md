# Smartsheet MCP Remote Server

This document explains how to deploy and use the Smartsheet MCP server as a remote HTTP server.

## Overview

The remote server exposes the Smartsheet MCP functionality via HTTP, accepting Smartsheet API credentials as headers in each request. This allows the server to be deployed remotely (e.g., Cloud Run, Kubernetes, Docker) and used by multiple clients without requiring local installation.

## Key Features

- **Remote deployment**: Deploy anywhere that supports Docker containers
- **Per-request authentication**: API credentials passed as headers, not environment variables
- **MCP protocol compliant**: Follows the Model Context Protocol specification
- **Optional authentication**: Supports authentication via `x-secret-key` header for tool execution
- **Discovery without auth**: Tool listing and initialization don't require authentication
- **Health checks**: Built-in health check endpoint for orchestration platforms

## Architecture

The remote server:
1. Accepts JSON-RPC 2.0 requests on the `/mcp` endpoint
2. Extracts Smartsheet API credentials from request headers
3. Creates a temporary MCP server instance with those credentials
4. Executes the requested tool
5. Returns results in MCP-compliant format

## Required Headers

When calling tools, the following headers are required:

- `x-smartsheet-api-key`: Your Smartsheet API token (required for `tools/call`)
- `x-smartsheet-endpoint`: Smartsheet API endpoint (optional, defaults to `https://api.smartsheet.com/2.0`)
- `x-allow-delete-tools`: Enable delete operations (optional, defaults to `false`)
- `x-secret-key`: Server authentication key (required if `REQUIRE_AUTH=true` and `SECRET_KEY` is set)

## Environment Variables

The server supports the following environment variables:

- `PORT`: Port to listen on (default: `8080`)
- `HOST`: Host to bind to (default: `0.0.0.0`)
- `REQUIRE_AUTH`: Require authentication for tool execution (default: `true`)
- `SECRET_KEY`: Secret key for authentication (optional, but recommended in production)
- `DEBUG`: Enable debug logging (default: `false`)

## Deployment

### Using Docker

1. Build the Docker image:
```bash
docker build -t smartsheet-mcp-remote .
```

2. Run the container:
```bash
docker run -p 8080:8080 \
  -e REQUIRE_AUTH=true \
  -e SECRET_KEY=your-secret-key-here \
  smartsheet-mcp-remote
```

### Using Docker Compose

1. Create a `.env` file:
```env
PORT=8080
REQUIRE_AUTH=true
SECRET_KEY=your-secret-key-here
DEBUG=false
```

2. Start the service:
```bash
docker-compose up -d
```

### Deploying to Google Cloud Run

1. Build and push to Google Container Registry:
```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/smartsheet-mcp
```

2. Deploy to Cloud Run:
```bash
gcloud run deploy smartsheet-mcp \
  --image gcr.io/YOUR_PROJECT_ID/smartsheet-mcp \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars REQUIRE_AUTH=true,SECRET_KEY=your-secret-key-here
```

### Deploying to AWS ECS/Fargate

1. Push image to ECR:
```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com
docker tag smartsheet-mcp-remote:latest YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/smartsheet-mcp:latest
docker push YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/smartsheet-mcp:latest
```

2. Create an ECS task definition and service using the pushed image

### Deploying to Kubernetes

Example deployment manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: smartsheet-mcp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: smartsheet-mcp
  template:
    metadata:
      labels:
        app: smartsheet-mcp
    spec:
      containers:
      - name: smartsheet-mcp
        image: smartsheet-mcp-remote:latest
        ports:
        - containerPort: 8080
        env:
        - name: REQUIRE_AUTH
          value: "true"
        - name: SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: smartsheet-mcp-secret
              key: secret-key
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: smartsheet-mcp
spec:
  selector:
    app: smartsheet-mcp
  ports:
  - port: 80
    targetPort: 8080
  type: LoadBalancer
```

## API Endpoints

### `GET /`
Root endpoint with server information

**Response:**
```json
{
  "service": "MCP Smartsheet Server",
  "version": "1.6.0",
  "description": "Model Context Protocol server for Smartsheet API",
  "endpoints": {
    "/health": "Health check endpoint",
    "/mcp": "MCP JSON-RPC endpoint",
    "/tools": "List available tools"
  },
  "documentation": "https://github.com/smartsheet-platform/smar-mcp"
}
```

### `GET /health`
Health check endpoint (for load balancers and orchestration)

**Response:**
```json
{
  "status": "healthy",
  "service": "mcp-smartsheet",
  "version": "1.6.0"
}
```

### `GET /tools`
List available tools (no authentication required)

**Response:**
```json
{
  "tools": [
    {
      "name": "get_sheet",
      "description": "Retrieves the current state of a sheet...",
      "inputSchema": { ... }
    },
    ...
  ]
}
```

### `POST /mcp`
Main MCP endpoint for JSON-RPC requests

**Request Example (initialize):**
```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {},
  "id": 1
}
```

**Request Example (tools/list):**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "params": {},
  "id": 2
}
```

**Request Example (tools/call):**
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "x-smartsheet-api-key: YOUR_SMARTSHEET_API_KEY" \
  -H "x-secret-key: YOUR_SECRET_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_sheet",
      "arguments": {
        "sheetId": "123456789"
      }
    },
    "id": 3
  }'
```

## Client Configuration

### Claude Desktop Configuration

Update your `claude_desktop_config.json` to use the remote server:

```json
{
  "mcpServers": {
    "smartsheet": {
      "url": "http://your-server-url:8080/mcp",
      "headers": {
        "x-smartsheet-api-key": "YOUR_SMARTSHEET_API_KEY",
        "x-secret-key": "YOUR_SECRET_KEY"
      }
    }
  }
}
```

### Python Client Example

```python
import requests

def call_mcp_tool(server_url, api_key, secret_key, tool_name, arguments):
    response = requests.post(
        f"{server_url}/mcp",
        headers={
            "Content-Type": "application/json",
            "x-smartsheet-api-key": api_key,
            "x-secret-key": secret_key
        },
        json={
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            },
            "id": 1
        }
    )
    return response.json()

# Example usage
result = call_mcp_tool(
    "http://localhost:8080",
    "YOUR_SMARTSHEET_API_KEY",
    "YOUR_SECRET_KEY",
    "get_sheet",
    {"sheetId": "123456789"}
)
print(result)
```

### TypeScript/JavaScript Client Example

```typescript
import axios from 'axios';

async function callMcpTool(
  serverUrl: string,
  apiKey: string,
  secretKey: string,
  toolName: string,
  arguments: any
) {
  const response = await axios.post(`${serverUrl}/mcp`, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: arguments
    },
    id: 1
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-smartsheet-api-key': apiKey,
      'x-secret-key': secretKey
    }
  });
  
  return response.data;
}

// Example usage
const result = await callMcpTool(
  'http://localhost:8080',
  'YOUR_SMARTSHEET_API_KEY',
  'YOUR_SECRET_KEY',
  'get_sheet',
  { sheetId: '123456789' }
);
console.log(result);
```

## Security Considerations

1. **Always use HTTPS in production**: Never transmit API keys over unencrypted connections
2. **Set a strong SECRET_KEY**: Use a randomly generated key for authentication
3. **Use environment variables**: Never hardcode secrets in your code or configuration
4. **Limit network access**: Use firewalls and security groups to restrict access
5. **Enable authentication**: Set `REQUIRE_AUTH=true` in production
6. **Monitor access logs**: Track who is accessing your server and when
7. **Rotate credentials regularly**: Update API keys and secret keys periodically

## Differences from Local Server

| Feature | Local Server | Remote Server |
|---------|-------------|---------------|
| Transport | stdio | HTTP |
| Credentials | Environment variables | Request headers |
| Authentication | N/A | Optional via SECRET_KEY |
| Deployment | Local installation | Docker/Cloud |
| Multi-user | No | Yes |
| Discovery | Via MCP client | HTTP endpoints |

## Troubleshooting

### Server won't start
- Check that port 8080 is not already in use
- Verify environment variables are set correctly
- Check logs for specific error messages

### Authentication errors
- Verify `x-secret-key` header matches `SECRET_KEY` environment variable
- Ensure `x-smartsheet-api-key` header is set for tool calls
- Check that `REQUIRE_AUTH` is set correctly

### Tool execution fails
- Verify Smartsheet API key is valid
- Check that the API endpoint is correct
- Ensure you have permissions for the requested operation
- Review server logs for detailed error messages

### Connection issues
- Verify the server is running and accessible
- Check firewall rules and network configuration
- Ensure the correct URL is being used
- Test with `/health` endpoint first

## Development

To run the remote server locally for development:

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the remote server
npm run start:remote
```

Or use the development script:
```bash
npm run dev:remote
```

## Testing

Test the server with curl:

```bash
# Health check
curl http://localhost:8080/health

# Initialize
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'

# List tools
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'

# Call a tool
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "x-smartsheet-api-key: YOUR_API_KEY" \
  -H "x-secret-key: YOUR_SECRET_KEY" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"search_sheets",
      "arguments":{"query":"test"}
    },
    "id":3
  }'
```

## Support

For issues, questions, or contributions:
- GitHub Issues: https://github.com/smartsheet-platform/smar-mcp/issues
- Documentation: https://github.com/smartsheet-platform/smar-mcp

## License

MIT License - see LICENSE file for details

