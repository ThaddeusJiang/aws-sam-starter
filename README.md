# SAM TypeScript Starter

A starter template for AWS SAM with TypeScript, providing a complete framework for Serverless API development.

## Features

- TypeScript Lambda function development
- ESLint and Prettier integration for code quality
- Zod for runtime type validation
- DynamoDB integration example
- Complete CRUD API example

## Example API

The Comments API demonstrates the following endpoints:
- GET /comments - List all comments
- GET /comments/{id} - Get a single comment
- POST /comments - Create a new comment
- PUT /comments/{id} - Update a comment
- DELETE /comments/{id} - Delete a comment

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Local development:
```bash
sam build
sam local start-api
```

3. Deploy:
```bash
sam deploy --guided
```

## Project Structure

```
.
├── README.md                   # Project documentation
├── template.yaml              # SAM template
├── samconfig.toml            # SAM configuration
└── comments/                 # Lambda function example
    ├── app.ts               # Main function code
    ├── package.json        # Dependencies
    ├── tsconfig.json      # TypeScript configuration
    ├── .eslintrc.json    # ESLint configuration
    └── .prettierrc       # Prettier configuration
```

## Prerequisites

- AWS CLI
- AWS SAM CLI
- Node.js 22+
- Docker

## Tech Stack

- TypeScript
- AWS SAM
- DynamoDB
- Zod
- ESLint + Prettier

## Development Commands

```bash
# Install dependencies
npm install

# Format code
npm run format

# Run tests
npm run test

# Build TypeScript
npm run build

# Validate SAM template
sam validate --lint

# Local API testing
sam local start-api

# Deploy to AWS
sam deploy --guided
```

## License

MIT

## Author

[ThaddeusJiang](https://github.com/ThaddeusJiang)
