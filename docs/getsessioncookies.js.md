---
description: >-
  The modules used for obtaining DigiKey session credentials, handling the
  authentication process, and managing cookies for API interactions.
---

# getSessionCookies.js

### Configuration

The configuration is set up using `dotenv` to load environment variables. Additionally, the `NODE_TLS_REJECT_UNAUTHORIZED` environment variable is set to "0" to bypass certificate validation issues.

```javascript
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { config } from "dotenv";
config();
```

### Functions

#### `getDigiKeyCookies`

Obtains session cookies from the DigiKey authentication process.

**Parameters**

* `userName` (string): The username for DigiKey.
* `pass` (string): The password for DigiKey.
* `retries` (number): Number of retry attempts (default: 3).

**Returns**

* `Object`: An object containing `supplierCookies`, `apiCookies`, and `authorizationCookies`.

**Example**

```javascript
async function getDigiKeyCookies(userName, pass, retries = 3) {
  // Function implementation
}
```

#### `getNonceFromLoginPage`

Extracts the nonce URL from the login page HTML.

**Parameters**

* `pageHTML` (string): HTML content of the login page.

**Returns**

* `string`: The URL containing the nonce.
* `null`: If the nonce is not found.

**Example**

```javascript
function getNonceFromLoginPage(pageHTML) {
  // Function implementation
}
```

#### `getTokenForMicroStrategy`

Fetches an authorization token for MicroStrategy using DigiKey session cookies.

**Parameters**

* `supplierCookies` (array): Array of supplier cookies.
* `authCookies` (array): Array of authorization cookies.
* `retries` (number): Number of retry attempts (default: 3).

**Returns**

* `string`: The authorization token.

**Example**

```javascript
async function getTokenForMicroStrategy(supplierCookies, authCookies, retries = 3) {
  // Function implementation
}
```

#### `getMicroStrategySession`

Fetches a session token for MicroStrategy using an authorization token.

**Parameters**

* `token` (string): The authorization token.
* `retries` (number): Number of retry attempts (default: 5).

**Returns**

* `Object`: An object containing `cookies` and `authToken`.

**Example**

```javascript
async function getMicroStrategySession(token, retries = 5) {
  // Function implementation
}
```

#### `microstrategySessionCredentials`

Obtains session credentials for MicroStrategy, including session cookies and an authorization token.

**Parameters**

* `userName` (string): The username for DigiKey.
* `pass` (string): The password for DigiKey.
* `retries` (number): Number of retry attempts (default: 5).

**Returns**

* `Object`: An object containing `sessionCookies` and `authToken`.

**Example**

```javascript
export async function microstrategySessionCredentials(userName, pass, retries = 5) {
  // Function implementation
}
```

### Usage

1. **Loading Environment Variables**: Ensure that you have a `.env` file with the required environment variables such as `digikey_project_id`.
2. **Obtaining DigiKey Cookies**: Use the `getDigiKeyCookies` function to get session cookies from the DigiKey authentication process.
3. **Extracting Nonce**: Use the `getNonceFromLoginPage` function to extract the nonce URL from the login page HTML.
4. **Fetching Authorization Token**: Use the `getTokenForMicroStrategy` function to get an authorization token using the DigiKey cookies.
5. **Fetching MicroStrategy Session**: Use the `getMicroStrategySession` function to get a session token for MicroStrategy.
6. **Getting Session Credentials**: Use the `microstrategySessionCredentials` function to get session credentials for MicroStrategy.

#### Example

```javascript
import { microstrategySessionCredentials } from './path/to/module';

const userName = 'your_username';
const pass = 'your_password';

microstrategySessionCredentials(userName, pass)
  .then(credentials => {
    console.log('Session Credentials:', credentials);
  })
  .catch(error => {
    console.error('Error getting session credentials:', error);
  });
```

This documentation provides a comprehensive overview of the modules, their functions, and how to use them to manage DigiKey authentication and MicroStrategy session credentials. For any further queries, refer to the source code or contact the development team.
