# Overview

### Overview

The DigiKey Dashboard API project is a Node.js application designed to interact with DigiKey's MicroStrategy platform to retrieve and serve CSV reports. The project uses Express for server-side operations, Puppeteer for web scraping and session management, and several middleware and utilities for security and performance. Additionally, it employs a CI/CD pipeline for automated build and deployment using GitHub Actions.

#### Key Components

1. [**index.js**](docs/index.js-express-router.md): The main entry point for the Express server.
2. [**login.js**](docs/login.js.md): Handles session management and CSV data retrieval using Puppeteer.
3. [**package.json**](docs/package.json.md): Defines project metadata, scripts, and dependencies.
4. [**GitHub Actions Workflow (yml file)**](docs/yml-file-and-docker-configs.md): Automates the build and deployment process to Azure Web App.
5. [**Puppeteer Configuration File**](broken-reference): Customizes the cache directory for Puppeteer.

### Detailed Breakdown

#### index.js

The `index.js` file initializes the Express application, configures middleware for security and rate limiting, defines authorization logic, and sets up a route to handle CSV file requests.

**Key Features**

* **Middleware Configuration**: Sets up JSON parsing and security headers using `helmet`.
* **Rate Limiting**: Limits the number of requests to prevent abuse.
* **Authorization**: Ensures requests are authorized using a predefined token.
* **Session Management**: Handles fetching and caching session credentials.
* **CSV Route**: Serves CSV files based on document type.

#### login.js

The `login.js` file contains functions to manage sessions with DigiKey using Puppeteer. It includes launching a browser, logging in, and retrieving session credentials and CSV data.

**Key Functions**

* **getDigiKeyMicroStrategySession**: Logs in to DigiKey and extracts session credentials.
* **getCredsFromSetHeaders**: Parses session cookies from response headers.
* **csvRequest**: Fetches CSV data from MicroStrategy based on document type.

#### package.json

The `package.json` file defines the project's metadata, scripts, and dependencies.

**Key Sections**

* **Metadata**: Includes the project's name, version, and main entry point.
* **Scripts**: Defines commands for running the application, including development and post-installation scripts.
* **Dependencies**: Lists external modules required by the project, such as Express, Puppeteer, and Helmet.

#### GitHub Actions Workflow

The GitHub Actions workflow file automates the build and deployment process for the Node.js application to Azure Web App.

**Workflow Jobs**

1. **Build Job**: Checks out the code, sets up Node.js, installs dependencies, and creates an artifact for deployment.
2. **Deploy Job**: Downloads the build artifact, installs necessary dependencies, logs into Azure, and deploys the application to Azure Web App.

#### Puppeteer Configuration File

The Puppeteer configuration file customizes the cache directory location for Puppeteer.

**Configuration Details**

* **cacheDirectory**: Defines the location for Puppeteer's cache files, ensuring consistency and avoiding potential issues in different environments.

### Usage

#### Running the Application

* **Development Mode**: Use `npm run dev` to start the server with automatic restarts on file changes.
* **Production Mode**: Use `npm start` to start the server.

#### CI/CD Pipeline

* **Trigger**: The workflow runs on push events to the `main` branch or can be manually triggered.
* **Build and Deploy**: The pipeline builds the application, creates an artifact, and deploys it to Azure Web App.

### Environment Variables

* **CHROME\_PATH**: Path to the Chrome executable for Puppeteer.
* **digikey\_username**: Username for DigiKey login.
* **digikey\_password**: Password for DigiKey login.
* **digikey\_project\_id**: Project ID for DigiKey MicroStrategy API.
* **AUTH\_TOKEN**: Authorization token for securing routes.
* **RATE\_LIMIT\_WINDOW\_MS**: Time window for rate limiting (in milliseconds).
* **RATE\_LIMIT\_MAX**: Maximum number of requests per IP per time window.
* **PORT**: Port on which the server runs.

### External Dependencies

* **express**: Web framework for Node.js.
* **helmet**: Security middleware for Express.
* **express-rate-limit**: Middleware for rate limiting requests.
* **puppeteer**: High-level API to control Chrome or Chromium.
*
