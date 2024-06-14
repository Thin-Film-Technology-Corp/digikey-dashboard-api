---
description: >-
  This workflow is designed to build and deploy our Node.js application to Azure
  Web App.
---

# Yml file & Docker configs

### Overview

The workflow automates the process of building and deploying the Node.js application. It consists of two main jobs:

* **Build**: Checks out the code, sets up Node.js, installs dependencies, builds the application, and creates an artifact for deployment.
* **Deploy**: Downloads the build artifact, installs necessary dependencies, logs into Azure, and deploys the application to Azure Web App.

### Workflow Trigger

```yaml
name: Build and deploy Node.js app to Azure Web App - digikey-dashboard-api

on:
  push:
    branches:
      - main
  workflow_dispatch:
```

* `name`: The name of the workflow.
* `on`:
  * `push`: The workflow runs when changes are pushed to the `main` branch.
  * `workflow_dispatch`: Allows manual triggering of the workflow.

### Jobs

#### Build Job

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
```

* `jobs`: Defines the jobs for the workflow.
* `build`: The build job.
* `runs-on`: Specifies the runner environment (Ubuntu).

**Steps**

1.  **Checkout Code**

    ```yaml
    steps:
      - uses: actions/checkout@v4
    ```

    * Uses the `actions/checkout@v4` action to check out the code from the repository.
2.  **Set Up Node.js**

    ```yaml
    - name: Set up Node.js version
        uses: actions/setup-node@v3
        with:
          node-version: "18.x"
    ```

    * Uses the `actions/setup-node@v3` action to set up Node.js version 18.x.
3.  **Install Puppeteer Dependencies**

    ```yaml
    - name: Install Puppeteer dependencies on build container
        run: |
          sudo apt-get update
          sudo apt-get install -y ...
    ```

    * Installs the necessary system dependencies for Puppeteer.
4.  **Install Node.js Dependencies and Build**

    ```yaml
    - name: npm install, build, and test
        run: |
          npm install
          npm run postinstall
    ```

    * Runs `npm install` to install project dependencies.
    * Runs `npm run postinstall` to execute any post-install scripts defined in `package.json`.
5.  **Zip Artifact for Deployment**

    ```yaml
    - name: Zip artifact for deployment
        run: zip release.zip ./* -r
    ```

    * Zips the build files into an artifact named `release.zip`.
6.  **Upload Artifact**

    ```yaml
    - name: Upload artifact for deployment job
        uses: actions/upload-artifact@v3
        with:
          name: node-app
          path: release.zip
    ```

    * Uses the `actions/upload-artifact@v3` action to upload the zipped artifact for the deployment job.

#### Deploy Job

```yaml
deploy:
    runs-on: ubuntu-latest
    needs: build
    environment:
      name: "Production"
      url: ${{ steps.deploy-to-webapp.outputs.webapp-url }}
    permissions:
      id-token: write
```

* `deploy`: The deploy job.
* `needs`: Specifies that the deploy job depends on the successful completion of the build job.
* `environment`: Sets the deployment environment to "Production".
* `permissions`: Grants necessary permissions for deployment.

**Steps**

1.  **Download Artifact**

    ```yaml
    - name: Download artifact from build job
        uses: actions/download-artifact@v3
        with:
          name: node-app
    ```

    * Uses the `actions/download-artifact@v3` action to download the artifact from the build job.
2.  **Unzip Artifact**

    ```yaml
    - name: Unzip artifact for deployment
        run: unzip release.zip
    ```

    * Unzips the downloaded artifact.
3.  **Install Puppeteer Dependencies**

    ```yaml
    - name: Install Puppeteer dependencies on deployment server
        run: |
          sudo apt-get update
          sudo apt-get install -y ...
    ```

    * Installs the necessary system dependencies for Puppeteer on the deployment server.
4.  **Login to Azure**

    ```yaml
    - name: Login to Azure
        uses: azure/login@v1
        with:
          client-id: ${{ secrets.AZUREAPPSERVICE_CLIENTID_D4BA4062753D47009DF15FF34DE3D01E }}
          tenant-id: ${{ secrets.AZUREAPPSERVICE_TENANTID_3066F6B52EFA4385A6ABD172315F4EE0 }}
          subscription-id: ${{ secrets.AZUREAPPSERVICE_SUBSCRIPTIONID_B2D3E7AC4D2746E1B83F7AB5E583F4B0 }}
    ```

    * Uses the `azure/login@v1` action to log into Azure using provided credentials.
5.  **Deploy to Azure Web App**

    ```yaml
    - name: "Deploy to Azure Web App"
        id: deploy-to-webapp
        uses: azure/webapps-deploy@v2
        with:
          app-name: "digikey-dashboard-api"
          slot-name: "Production"
          package: .
    ```

    * Uses the `azure/webapps-deploy@v2` action to deploy the application to the Azure Web App named `digikey-dashboard-api`.
6.  **Install dependencies in Azure container**

    * You will need to install Chrome browser dependencies manually in the newly created container, use the following command

    ```sh
    apt-get install -y \
                  gconf-service \
                  libasound2 \
                  libatk1.0-0 \
                  libcups2 \
                  libdbus-1-3 \
                  libgdk-pixbuf2.0-0 \
                  libnspr4 \
                  libxss1 \
                  lsb-release \
                  xdg-utils \
                  wget \
                  libnss3 \
                  libx11-xcb1 \
                  libxcomposite1 \
                  libxcursor1 \
                  libxdamage1 \
                  libxi6 \
                  libxtst6 \
                  fonts-liberation \
                  libayatana-appindicator1 \
                  libayatana-appindicator3-1 \
                  libpango1.0-0 \
                  libpangocairo-1.0-0 \
                  libatk-bridge2.0-0 \
                  libcairo2 \
                  libxrandr2 \
                  libgtk-3-0 \
                  libgbm1 \
                  libpango-1.0-0 \
                  libcairo2 \
                  libpangoft2-1.0-0 \
                  libgl1 \
                  libglib2.0-0 \
                  libdrm2
    ```
