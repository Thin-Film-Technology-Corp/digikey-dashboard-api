// ! unfortunately the root CA refuses to authorize from DigiKey so this is the only work around I can currently use
import { config } from "dotenv";
config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export async function getDigiKeyCookies(userName, pass, retries = 3) {
  try {
    if (retries <= 0) {
      throw new Error("Exceeded maximum retries to get DigiKey cookies.");
    }

    let encodedUserName = encodeURIComponent(userName);
    let encodedPass = encodeURIComponent(pass).replace(/!/g, "%21");

    // Step 1: Initialize Authentication
    console.log(`connecting to https://supplier.digikey.com/`);
    const initializeAuth = await fetch("https://supplier.digikey.com/", {
      headers: {
        "Access-Control-Expose-Headers": "Location",
      },
      redirect: "manual",
    });

    let oauthURL = initializeAuth.headers.get("location");
    let authCookies = initializeAuth.headers.getSetCookie();
    if (!oauthURL) {
      throw new Error("Failed to retrieve OAuth URL from initializeAuth");
    }

    // Step 2: Redirect to a login page
    console.log(`connecting to ${oauthURL}`);
    let authLogin = await fetch(oauthURL, {
      headers: {
        cookie: authCookies.join("; "),
      },
      redirect: "manual",
    });

    let authPingURL = getNonceFromLoginPage(await authLogin.text());
    let authLoginCookies = authLogin.headers.getSetCookie();
    if (!authPingURL) {
      throw new Error("Failed to retrieve authPingURL from login page");
    }

    // Step 3: Use login page with nonce and new cookies to send credentials
    console.log(`connecting to ${authPingURL}`);
    let authPingResult = await fetch(authPingURL, {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "Access-Control-Expose-Headers": "Location",
        cookie: authLoginCookies.join("; "),
      },
      body: `pf.username=${encodedUserName}&pf.pass=${encodedPass}&pf.ok=clicked&pf.adapterId=authform`,
      method: "POST",
      redirect: "manual",
    });

    authCookies = [...authCookies, ...authPingResult.headers.getSetCookie()];
    authLoginCookies = [
      ...authLoginCookies,
      ...authPingResult.headers.getSetCookie(),
    ];

    // Step 4: Go to the supplier.digikey URL that gets returned
    let supplierAuthURL = authPingResult.headers.get("location");
    if (!supplierAuthURL) {
      throw new Error("Failed to retrieve supplierAuthURL from authPingResult");
    }

    console.log(`connecting to ${supplierAuthURL}`);
    let supplierAuth = await fetch(supplierAuthURL, {
      headers: {
        "Access-Control-Expose-Headers": "Location",
        cookie: authCookies.join("; "),
      },
      redirect: "manual",
    });

    authCookies = supplierAuth.headers.getSetCookie();

    // Step 5: Go to supplier.digikey.com with the new cookies to get a session ID
    let supplierSessionURL = supplierAuth.headers.get("location");
    if (!supplierSessionURL) {
      throw new Error(
        "Failed to retrieve supplierSessionURL from supplierAuth"
      );
    }

    console.log(`connecting to ${supplierSessionURL}`);
    let supplierSession = await fetch(supplierSessionURL, {
      headers: {
        cookie: authCookies.join("; "),
        "Access-Control-Expose-Headers": "Location",
      },
      redirect: "manual",
    });

    console.log(`connecting to https://supplier.digikey.com/login`);
    let supplierLogin = await fetch("https://supplier.digikey.com/login", {
      headers: {
        "Access-Control-Expose-Headers": "Location",
        cookie: authCookies.join("; "),
      },
      redirect: "manual",
    });

    let supplierLoginURL = supplierLogin.headers.get("location");
    if (!supplierLoginURL) {
      throw new Error("Failed to retrieve supplierLoginURL from supplierLogin");
    }

    console.log(`connecting to ${supplierLoginURL}`);
    let apiOauth = await fetch(supplierLoginURL, {
      headers: {
        "Access-Control-Expose-Headers": "Location",
        cookie: authCookies.join("; "),
      },
      redirect: "manual",
    });

    let apiCookies = apiOauth.headers.getSetCookie();
    let apiRedirectURL = apiOauth.headers.get("location");
    if (!apiRedirectURL) {
      throw new Error("Failed to retrieve apiRedirectURL from apiOauth");
    }

    console.log(`connecting to ${apiRedirectURL}`);
    let apiRedirect = await fetch(apiRedirectURL, {
      headers: {
        "Access-Control-Expose-Headers": "Location",
        cookie: authLoginCookies.join("; "),
      },
      redirect: "manual",
    });

    authLoginCookies = [
      ...authLoginCookies,
      ...apiRedirect.headers.getSetCookie(),
    ];

    let apiCodeURL = apiRedirect.headers.get("location");
    if (!apiCodeURL) {
      throw new Error("Failed to retrieve apiCodeURL from apiRedirect");
    }

    console.log(`connecting to ${apiCodeURL}`);
    let apiCode = await fetch(apiCodeURL, {
      headers: {
        "Access-Control-Expose-Headers": "Location",
        cookie: apiCookies.join("; "),
      },
      redirect: "manual",
    });

    let supplierCallBackURL = apiCode.headers.get("location");
    if (!supplierCallBackURL) {
      throw new Error("Failed to retrieve supplierCallBackURL from apiCode");
    }

    console.log(`connecting to ${supplierCallBackURL}`);
    let supplierCallBack = await fetch(supplierCallBackURL, {
      headers: {
        "Access-Control-Expose-Headers": "Location",
        cookie: authCookies.join("; "),
      },
      redirect: "manual",
    });

    authCookies = [...authCookies, ...supplierCallBack.headers.getSetCookie()];

    return {
      supplierCookies: authCookies,
      apiCookies: apiCookies,
      authorizationCookies: authLoginCookies,
    };
  } catch (error) {
    console.error(`Error in getDigiKeyCookies: ${error.message}`);
    if (retries > 1) {
      console.log(`Retrying... (${retries - 1} retries left)`);
      return await getDigiKeyCookies(userName, pass, retries - 1);
    } else {
      throw new Error("Failed to get DigiKey cookies after multiple retries.");
    }
  }
}

export function getNonceFromLoginPage(pageHTML) {
  try {
    let authPingCodeRegex = /\/as\/([^\/]+)\/resume\/as\/authorization\.ping/gm;
    let authPingCodeMatch = authPingCodeRegex.exec(pageHTML);

    if (!authPingCodeMatch) {
      throw new Error("authPingCode not found in HTML");
    }

    let authPingCode = authPingCodeMatch[1];
    return `https://auth.digikey.com/as/${authPingCode}/resume/as/authorization.ping`;
  } catch (error) {
    console.error(`Error in getNonceFromLoginPage: ${error.message}`);
    return null; // or you could return an appropriate fallback value
  }
}

export async function getTokenForMicroStrategy(
  supplierCookies,
  authCookies,
  userName,
  pass,
  retries
) {
  try {
    if (retries <= 0) {
      throw new Error("Exceeded maximum retries to get token.");
    }

    console.log(`connecting to https://supplier.digikey.com/reporting`);
    let reportingSID = await fetch("https://supplier.digikey.com/reporting", {
      headers: {
        cookie: supplierCookies.join("; "),
        "Access-Control-Expose-Headers": "Location",
      },
      redirect: "manual",
    });

    supplierCookies = supplierCookies.filter((a) => !a.includes("connect.sid"));
    supplierCookies = [
      ...supplierCookies,
      ...reportingSID.headers.getSetCookie(),
    ];

    console.log(`connecting to https://supplier.digikey.com/reporting/login`);
    let reportingOAuth = await fetch(
      "https://supplier.digikey.com/reporting/login",
      {
        headers: {
          cookie: supplierCookies.join("; "),
          "Access-Control-Expose-Headers": "Location",
        },
        redirect: "manual",
      }
    );

    const reportingOAuthLocation = reportingOAuth.headers.get("location");
    if (!reportingOAuthLocation) {
      console.error("No location header in reportingOAuth response");
      return await getTokenForMicroStrategy(
        supplierCookies,
        authCookies,
        retries - 1
      );
    }

    console.log(`connecting to ${reportingOAuthLocation}`);
    let authCodeChallenge = await fetch(reportingOAuthLocation, {
      headers: {
        "Access-Control-Expose-Headers": "Location",
        cookie: authCookies.join("; "),
      },
      redirect: "manual",
    });

    const authCodeChallengeLocation = authCodeChallenge.headers.get("location");
    if (!authCodeChallengeLocation) {
      console.error("No location header in authCodeChallenge response");
      return await getTokenForMicroStrategy(
        supplierCookies,
        authCookies,
        retries - 1
      );
    }

    console.log(`connecting to ${authCodeChallengeLocation}`);
    let supplierTokenRequest = await fetch(authCodeChallengeLocation, {
      headers: {
        "Access-Control-Expose-Headers": "Location",
        cookie: supplierCookies.join("; "),
      },
      redirect: "manual",
    });

    if (
      supplierTokenRequest.status === 302 &&
      supplierTokenRequest.headers.get("location") != "/reporting/fail"
    ) {
      let token = supplierTokenRequest.headers.get("location").split("=")[1];
      console.log(supplierTokenRequest.headers.get("location"));
      console.log(`Token extracted: ${token}`);
      if (!token) {
        console.warn("Token not found, retrying...");
        return await getTokenForMicroStrategy(
          supplierCookies,
          authCookies,
          retries - 1
        );
      }

      if (token.includes("&")) {
        token = token.split("&")[0];
      }

      return token;
    } else {
      console.error(
        `Error getting token for session: ${supplierTokenRequest.status} ${supplierTokenRequest.statusText}`
      );
      const cookieRepeat = await getDigiKeyCookies(userName, pass);
      return await getTokenForMicroStrategy(
        cookieRepeat.supplierCookies,
        cookieRepeat.authorizationCookies,
        retries - 1
      );
    }
  } catch (error) {
    console.error(`Error in getTokenForMicroStrategy: ${error.message}`);
    if (retries > 1) {
      console.log(`Retrying... (${retries - 1} retries left)`);
      return await getTokenForMicroStrategy(
        supplierCookies,
        authCookies,
        retries - 1
      );
    } else {
      throw new Error("Failed to get token after multiple retries.");
    }
  }
}

export async function getMicroStrategySession(token, retries = 5) {
  try {
    if (retries <= 0) {
      throw new Error("Exceeded maximum retries to get MicroStrategy session.");
    }

    let sessionCookies = await fetch(
      "https://digikey.cloud.microstrategy.com/MicroStrategyLibrarySRPortal/api/auth/delegate",
      {
        headers: {
          "Access-Control-Expose-Headers": "Location",
          "content-type": "application/json",
        },
        redirect: "manual",
        body: `{"loginMode":-1,"identityToken":"${token}"}`,
        method: "POST",
      }
    );

    let authToken = sessionCookies.headers.get("x-mstr-authtoken");
    let retObj = {
      cookies: sessionCookies.headers.getSetCookie().join("; "),
      authToken: authToken,
    };

    if (!retObj.authToken) {
      console.warn("Auth token missing, retrying...");
      return await getMicroStrategySession(token, retries - 1);
    }

    return retObj;
  } catch (error) {
    console.error(`Error in getMicroStrategySession: ${error.message}`);
    if (retries > 1) {
      console.log(`Retrying... (${retries - 1} retries left)`);
      return await getMicroStrategySession(token, retries - 1);
    } else {
      throw new Error(
        "Failed to get MicroStrategy session after multiple retries."
      );
    }
  }
}

export async function microstrategySessionCredentials(
  userName,
  pass,
  retries = 5
) {
  try {
    if (retries <= 0) {
      throw new Error("Exceeded maximum retries to get session credentials.");
    }

    const digiKeyCookies = await getDigiKeyCookies(userName, pass);
    const token = await getTokenForMicroStrategy(
      digiKeyCookies.supplierCookies,
      digiKeyCookies.authorizationCookies,
      userName,
      pass
    );
    const microStrategyCredentials = await getMicroStrategySession(token);

    let retObj = {
      sessionCookies: microStrategyCredentials.cookies,
      authToken: microStrategyCredentials.authToken,
    };

    if (!retObj.authToken || !retObj.sessionCookies) {
      console.warn("Auth token or session cookies missing, retrying...");
      return await microstrategySessionCredentials(userName, pass, retries - 1);
    }
    // process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";

    return retObj;
  } catch (error) {
    console.error(`Error in microstrategySessionCredentials: ${error.message}`);
    if (retries > 1) {
      console.log(`Retrying... (${retries - 1} retries left)`);
      return await microstrategySessionCredentials(userName, pass, retries - 1);
    } else {
      throw new Error(
        "Failed to get session credentials after multiple retries."
      );
    }
  }
}

// microstrategySessionCredentials(
//   process.env.digikey_username,
//   process.env.digikey_password
// ).then((cookies) => {
//   console.log(cookies);
// });
