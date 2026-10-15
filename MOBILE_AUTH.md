# Signing in from the mobile app

The website signs in with an httpOnly cookie. A native app (Capacitor, React Native) can't rely on that cookie, so it uses tokens instead. Everything else in the API is the same.

## Sign in or sign up

Send the usual `POST /login` or `POST /signup` with one extra header:

```
X-Auth-Mode: token
X-Device-Name: Pixel 8        (optional; shown in Profile → Signed-in devices)
```

The response has the usual `user`, plus:

```json
"tokens": {
  "accessToken": "eyJ…",      // send on every request, valid 15 minutes
  "refreshToken": "q3V…",     // keep in secure storage (Keychain / Keystore)
  "expiresIn": 900            // seconds
}
```

No cookie is set in this mode.

## Calling the API

```
Authorization: Bearer <accessToken>
```

## When the access token expires (401)

```
POST /auth/refresh
{ "refreshToken": "<refreshToken>" }
```

| Response | Meaning                                                                                    | What the app does                                               |
| -------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 200      | `{ tokens }`: a new access token **and a new refresh token**                               | Save both; the old refresh token no longer works                |
| 409      | Another request refreshed with this token a moment ago                                     | Use the tokens that request got (refresh one request at a time) |
| 401      | Session ended (signed out elsewhere, password changed, or an old refresh token was reused) | Delete the tokens, show the sign-in screen                      |
| 400      | No refresh token sent                                                                      | Bug in the app                                                  |

Refresh tokens rotate on every use. If an old one is ever used again more than 30 seconds later, the server assumes it was copied and ends that session. So refresh from one place in the app, and always store the newest token.

An app session stays signed in while the app is used at least once every 60 days.

## Sign out

```
POST /logout
{ "refreshToken": "<refreshToken>" }
```

Works even if the access token has expired. Then delete both tokens from the device.

## Other endpoints that return tokens

- `PATCH /user/password` (change password) signs out every other device and returns fresh `tokens` for this one.

## Server settings

- `CORS_ORIGINS`: comma-separated extra origins the API accepts, e.g. `capacitor://localhost,https://localhost` for a Capacitor app. Not needed when the app calls the API through a native HTTP plugin.
