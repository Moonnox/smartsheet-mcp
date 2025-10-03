# Quick Start Guide: Remote MCP Server

This guide will help you quickly deploy and test the Smartsheet MCP Remote Server.

## Local Testing

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Start the Remote Server

```bash
# With default settings (no authentication)
REQUIRE_AUTH=false npm run start:remote

# Or with authentication
REQUIRE_AUTH=true SECRET_KEY=my-secret-key npm run start:remote
```

The server will start on `http://localhost:8080`.

### 4. Test the Server

Test with curl:

```bash
# Health check
curl http://localhost:8080/health

# List tools (no auth required)
curl http://localhost:8080/tools

# Initialize (MCP protocol)
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {},
    "id": 1
  }'

# List tools via MCP
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 2
  }'

# Call a tool (requires your Smartsheet API key)
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "x-smartsheet-api-key: YOUR_SMARTSHEET_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_current_user",
      "arguments": {}
    },
    "id": 3
  }'
```

## Docker Deployment

### 1. Build Docker Image

```bash
docker build -t smartsheet-mcp-remote .
```

### 2. Run Container

```bash
docker run -p 8080:8080 \
  -e REQUIRE_AUTH=true \
  -e SECRET_KEY=your-secret-key-here \
  smartsheet-mcp-remote
```

### 3. Or Use Docker Compose

Create `.env` file:
```env
PORT=8080
REQUIRE_AUTH=true
SECRET_KEY=your-secret-key-here
```

Start:
```bash
docker-compose up -d
```

View logs:
```bash
docker-compose logs -f
```

Stop:
```bash
docker-compose down
```

## Cloud Deployment

### Google Cloud Run

```bash
# Set your project ID
export PROJECT_ID=your-project-id

# Build and push
gcloud builds submit --tag gcr.io/$PROJECT_ID/smartsheet-mcp

# Deploy
gcloud run deploy smartsheet-mcp \
  --image gcr.io/$PROJECT_ID/smartsheet-mcp \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars REQUIRE_AUTH=true,SECRET_KEY=your-secret-key
```

### AWS ECS/Fargate

See [REMOTE-SERVER.md](REMOTE-SERVER.md) for detailed instructions.

### Kubernetes

```bash
kubectl apply -f k8s-deployment.yaml
```

## Configuration via Headers

When calling tools, pass these headers:

| Header | Required | Description |
|--------|----------|-------------|
| `x-smartsheet-api-key` | Yes | Your Smartsheet API token |
| `x-smartsheet-endpoint` | No | API endpoint (default: `https://api.smartsheet.com/2.0`) |
| `x-allow-delete-tools` | No | Enable delete operations (`true`/`false`) |
| `x-secret-key` | Conditional | Required if `REQUIRE_AUTH=true` |

## Example Client (Node.js)

```javascript
const axios = require('axios');

async function callSmartsheetTool() {
  const response = await axios.post('http://localhost:8080/mcp', {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'search_sheets',
      arguments: {
        query: 'project'
      }
    },
    id: 1
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-smartsheet-api-key': 'YOUR_API_KEY',
      'x-secret-key': 'YOUR_SECRET_KEY'  // if REQUIRE_AUTH=true
    }
  });

  console.log(JSON.stringify(response.data, null, 2));
}

callSmartsheetTool();
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `REQUIRE_AUTH` | `true` | Require authentication for tool calls |
| `SECRET_KEY` | (none) | Secret key for authentication |
| `DEBUG` | `false` | Enable debug logging |

## Security Best Practices

1. **Always use HTTPS in production** - Never expose the server over HTTP in production
2. **Set a strong SECRET_KEY** - Use a randomly generated key
3. **Enable REQUIRE_AUTH** - Always require authentication in production
4. **Rotate keys regularly** - Update API keys and secret keys periodically
5. **Use environment variables** - Never hardcode secrets
6. **Monitor access logs** - Track who is accessing your server
7. **Limit network access** - Use firewalls to restrict access

## Troubleshooting

### Server won't start
- Check port 8080 is not in use: `lsof -i :8080`
- Verify environment variables are set correctly
- Check build completed successfully: `npm run build`

### Authentication errors
- Verify `SECRET_KEY` matches between server and client
- Ensure `x-smartsheet-api-key` header is set
- Check `REQUIRE_AUTH` setting

### Tool execution fails
- Verify Smartsheet API key is valid
- Check you have permissions for the operation
- Review server logs for detailed errors

## Next Steps

- Read the full documentation: [REMOTE-SERVER.md](REMOTE-SERVER.md)
- Explore available tools: `curl http://localhost:8080/tools`
- Set up monitoring and logging for production
- Configure TLS/SSL certificates
- Set up a reverse proxy (nginx, Caddy)

## Support

- GitHub Issues: https://github.com/smartsheet-platform/smar-mcp/issues
- Documentation: https://github.com/smartsheet-platform/smar-mcp

