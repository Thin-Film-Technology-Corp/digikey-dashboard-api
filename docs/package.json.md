---
description: >-
  The package.json file is the manifest for the Node.js project, defining
  project metadata, dependencies, and scripts.
---

# Package.json

## package.json Documentation

### Overview

The `package.json` file contains the following key sections:

* Project metadata: Basic information about the project.
* Scripts: Commands that can be run using npm.
* Dependencies: External modules required by the project.

### Metadata

```json
{
  "name": "digikeydashboard",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "type": "module",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1",
    "dev": "nodemon index.js",
    "start": "node index.js"
  },
  "author": "",
  "license": "ISC",
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.3.1",
    "helmet": "^7.1.0",
    "mongodb": "^6.7.0",
    "node-cron": "^3.0.3",
    "nodemon": "^3.1.3",
    "path": "^0.12.7"
  }
}
```

* `name`: The name of the project (`digikeydashboard`).
* `version`: The current version of the project (`1.0.0`).
* `description`: A brief description of the project (currently empty).
* `main`: The entry point of the application (`index.js`).
* `type`: Specifies the module type (`module`), indicating that the project uses ES modules.

### Scripts

```json
"scripts": {
  "test": "echo \"Error: no test specified\" && exit 1",
  "dev": "nodemon index.js",
  "start": "node index.js"
}
```

* `test`: A placeholder for running tests (currently not specified).
* `dev`: Starts the server using `nodemon`, which automatically restarts the server on file changes.
* `start`: Starts the server using `node`.

### Author and License

```json
"author": "",
"license": "ISC"
```

* `author`: The author of the project (currently unspecified).
* `license`: The licensing terms (ISC).

### Dependencies

```json
"dependencies": {
  "dotenv": "^16.4.5",
  "express": "^4.19.2",
  "express-rate-limit": "^7.3.1",
  "helmet": "^7.1.0",
  "mongodb": "^6.7.0",
  "node-cron": "^3.0.3",
  "nodemon": "^3.1.3",
  "path": "^0.12.7"
}
```

* `dotenv`: Loads environment variables from a `.env` file into `process.env`.
* `express`: A fast, unopinionated, minimalist web framework for Node.js.
* `express-rate-limit`: Middleware for rate limiting requests to APIs.
* `helmet`: Helps secure Express apps by setting various HTTP headers.
* `mongodb`: Official MongoDB driver for Node.js.
* `node-cron`: A task scheduler in pure JavaScript for Node.js.
* `nodemon`: A tool that automatically restarts the node application when file changes are detected.
* `path`: Provides utilities for working with file and directory paths.

### Usage

#### Running the Application

To start the application in development mode with automatic restarts on file changes:

```bash
npm run dev
```

To start the application normally:

```bash
npm start
```

This completes the documentation for the `package.json` file. For further details or questions, please refer to the source code or contact the development team.
