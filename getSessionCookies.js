// ! unfortunately the root CA refuses to authorize from DigiKey so this is the only work around I can currently use
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { config } from "dotenv";
config();

async function getDigiKeyCookies(userName, pass) {
  let encodedUserName = encodeURIComponent(userName);
  let encodedPass = encodeURIComponent(pass).replace(/!/g, "%21");

  // Step 1: Initialize Authentication - Gives an auth.digikey url with:
  // response_type, client_id, redirect_url, state, nonce, scope, vnd_pa_requested_resource, vnd_pi_application_name
  console.log(`connecting to https://supplier.digikey.com/`);
  const initializeAuth = await fetch("https://supplier.digikey.com/", {
    headers: {
      "Access-Control-Expose-Headers": "Location",
    },
    redirect: "manual",
  });

  let oauthURL = initializeAuth.headers.get("location");
  let authCookies = initializeAuth.headers.getSetCookie();

  // Step 2: redirect to a login page, from here we capture the cookies and the nonce for the login
  // post url
  console.log(`connecting to ${oauthURL}`);
  let authLogin = await fetch(oauthURL, {
    headers: {
      cookie: authCookies.join("; "),
    },
    redirect: "manual",
  });

  let authPingURL = getNonceFromLoginPage(await authLogin.text());
  let authLoginCookies = authLogin.headers.getSetCookie();

  // Step 3: use login page with nonce and new cookies from page to send credentials
  // this gives us a supplier.digikey url that will be required to get to reports
  console.log(`connecting to ${authPingURL}`);
  let authPingResult = await fetch(authPingURL, {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "Access-Control-Expose-Headers": "Location",
      cookie: authLoginCookies,
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

  // Step 4: go to the supplier.digikey url that gets returned which includes the code and the state
  // Only add in the supplier.digikey cookies up to this point.
  // This will return the PA.Marketplace cookie which is one of the required cookies
  console.log(`connecting to ${authPingResult.headers.get("location")}`);
  let supplierAuth = await fetch(authPingResult.headers.get("location"), {
    headers: {
      "Access-Control-Expose-Headers": "Location",
      cookie: authCookies.join("; "),
    },
    redirect: "manual",
  });

  // reset auth cookies to the usable PA>Marketplace cookie
  authCookies = supplierAuth.headers.getSetCookie();

  // Step 5: go to supplier.digikey.com with the new cookies to get a session ID
  console.log(`connecting to ${supplierAuth.headers.get("location")}`);
  let supplierSession = await fetch(supplierAuth.headers.get("location"), {
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

  // ! break this out

  // https://api.digikey.com/v1/oauth2/authorize?response_type=code&redirect_uri=https%3A%2F%2Fsupplier.digikey.com%2Flogin%2Fcallback%2F&client_id=68SL5OA39qIsWK1HDgKktoJcUEFAqMAf
  console.log(`connecting to ${supplierLogin.headers.get("location")}`);
  let apiOauth = await fetch(supplierLogin.headers.get("location"), {
    headers: {
      "Access-Control-Expose-Headers": "Location",
      cookie: authCookies.join("; "),
    },
    redirect: "manual",
  });

  let apiCookies = apiOauth.headers.getSetCookie();

  console.log(`connecting to ${apiOauth.headers.get("location")}`);
  let apiRedirect = await fetch(apiOauth.headers.get("location"), {
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

  console.log(`connecting to ${apiRedirect.headers.get("location")}`);
  let apiCode = await fetch(apiRedirect.headers.get("location"), {
    headers: {
      "Access-Control-Expose-Headers": "Location",
      cookie: apiCookies.join("; "),
    },
    redirect: "manual",
  });

  console.log(`connecting to ${apiCode.headers.get("location")}`);
  let supplierCallBack = await fetch(apiCode.headers.get("location"), {
    headers: {
      "Access-Control-Expose-Headers": "Location",
      cookie: authCookies.join("; "),
    },
    redirect: "manual",
  });

  authCookies = [...authCookies, ...supplierCallBack.headers.getSetCookie()];
  console.log(`connecting to https://supplier.digikey.com/`);
  let testSupplier = await fetch("https://supplier.digikey.com/", {
    headers: {
      cookie: authCookies.join("; "),
      "Access-Control-Expose-Headers": "Location",
    },
    redirect: "manual",
  });
  return {
    supplierCookies: authCookies,
    apiCookies: apiCookies,
    authorizationCookies: authLoginCookies,
  };
  return authCookies;
}

function getNonceFromLoginPage(pageHTML) {
  let authPingCodeRegex = /\/as\/([^\/]+)\/resume\/as\/authorization\.ping/gm;
  let authPingCodeMatch = authPingCodeRegex.exec(pageHTML);

  if (!authPingCodeMatch) {
    throw new Error("authPingCode not found in HTML");
  }

  let authPingCode = authPingCodeMatch[1];
  return `https://auth.digikey.com/as/${authPingCode}/resume/as/authorization.ping`;
}

async function getTokenForMicroStrategy(supplierCookies, authCookies) {
  console.log(`connecting to https://supplier.digikey.com/reporting`);
  let reportingSID = await fetch("https://supplier.digikey.com/reporting", {
    headers: {
      cookie: supplierCookies.join("; "),
      "Access-Control-Expose-Headers": "Location",
    },
    redirect: "manual",
  });

  // Replace the session id
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

  console.log(`connecting to ${reportingOAuth.headers.get("location")}`);
  let authCodeChallenge = await fetch(reportingOAuth.headers.get("location"), {
    headers: {
      "Access-Control-Expose-Headers": "Location",
      cookie: authCookies.join("; "),
    },
    redirect: "manual",
  });

  console.log(`connecting to ${authCodeChallenge.headers.get("location")}`);
  let supplierTokenRequest = await fetch(
    authCodeChallenge.headers.get("location"),
    {
      headers: {
        "Access-Control-Expose-Headers": "Location",
        cookie: supplierCookies.join("; "),
      },
      redirect: "manual",
    }
  );

  let token = supplierTokenRequest.headers.get("location").split("=")[1];

  if (token.includes("&")) {
    token = token.split("&")[0];
  }
  return token;
}

async function getMicroStrategySession(token) {
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

  return {
    cookies: sessionCookies.headers.getSetCookie().join("; "),
    authToken: authToken,
  };
}

export async function microstrategySessionCredentials(userName, pass) {
  const digiKeyCookies = await getDigiKeyCookies(userName, pass);
  const token = await getTokenForMicroStrategy(
    digiKeyCookies.supplierCookies,
    digiKeyCookies.authorizationCookies
  );
  const microStrategyCredentials = await getMicroStrategySession(token);

  return {
    sessionCookies: microStrategyCredentials.cookies,
    authToken: microStrategyCredentials.authToken,
  };
}

// microstrategySessionCredentials(
//   process.env.digikey_username,
//   process.env.digikey_password
// ).then((cookies) => {
//   console.log(cookies);
// });
