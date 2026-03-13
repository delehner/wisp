# User Authentication with OAuth

> **Status**: Ready
> **Author**: Denilson
> **Date**: 2026-03-12
> **Priority**: P1 (High)
> **Working Branch**: denilson/oauth-authentication

## Target Repositories

| Repository | Branch |
|-----------|--------|
| https://github.com/example/my-web-app | main |

## Overview

Add OAuth-based authentication (Google and GitHub providers) to the web application, replacing the current email/password-only login. Users should be able to sign in with their existing Google or GitHub accounts with a single click.

## Background & Motivation

Current email/password authentication has a 40% drop-off rate during registration. Users frequently request social login options. Adding OAuth will reduce friction and increase conversion rates for new user signups.

## Goals

- **Primary**: Users can sign in/up with Google or GitHub in under 3 seconds
- **Secondary**: Reduce signup drop-off rate by 50%

## Non-Goals

- Migrating existing email/password users (they keep their current login method)
- Adding other OAuth providers (Apple, Microsoft) — future PRD
- Implementing 2FA — separate PRD

## User Stories

### End User
- As a new user, I want to sign up with my Google account so that I don't have to create another password
- As a returning user, I want to sign in with GitHub so that I can access my account quickly
- As a user with an existing email account, I want to link my Google/GitHub account so I can use either method

### Admin
- As an admin, I want to see which authentication method each user uses so I can provide appropriate support

## Requirements

### Functional Requirements

1. **FR-1: Google OAuth Login**
   - Description: Users can authenticate using their Google account via OAuth 2.0
   - Acceptance Criteria:
     - [ ] "Sign in with Google" button on login page
     - [ ] Redirects to Google consent screen
     - [ ] Creates user account on first login
     - [ ] Returns to app with active session on success
     - [ ] Shows error message on failure

2. **FR-2: GitHub OAuth Login**
   - Description: Users can authenticate using their GitHub account via OAuth
   - Acceptance Criteria:
     - [ ] "Sign in with GitHub" button on login page
     - [ ] Redirects to GitHub authorization page
     - [ ] Creates user account on first login
     - [ ] Returns to app with active session on success

3. **FR-3: Account Linking**
   - Description: Existing users can link OAuth providers to their account
   - Acceptance Criteria:
     - [ ] Settings page shows connected accounts
     - [ ] Users can connect/disconnect OAuth providers
     - [ ] Cannot disconnect last authentication method

### Non-Functional Requirements

- **Performance**: OAuth flow completes in under 3 seconds (excluding provider redirect)
- **Security**: OAuth tokens stored securely, PKCE flow used, state parameter validated
- **Accessibility**: OAuth buttons meet WCAG AA contrast, keyboard navigable

## Technical Constraints

- Next.js 15 with App Router
- PostgreSQL with Prisma ORM
- Must use NextAuth.js (Auth.js) v5 for OAuth implementation
- Session strategy: JWT

## UI/UX Requirements

- **Pages**: Modified login page, new account settings section
- **Key Interactions**: One-click OAuth buttons, provider connection management
- **Responsive Requirements**: OAuth buttons stack vertically on mobile

## Data Model Changes

- **New Entity**: `Account` — stores OAuth provider connections (NextAuth schema)
- **Modified Entity**: `User` — add optional `image` and `emailVerified` fields

## API Changes

- **New Endpoints**: NextAuth.js handles `/api/auth/*` routes automatically
- **No Breaking Changes**

## Dependencies

- next-auth@5 (Auth.js) — OAuth framework
- @auth/prisma-adapter — database adapter

## Risks & Open Questions

| Risk/Question | Impact | Status |
|--------------|--------|--------|
| Google OAuth app approval may take time | Medium | Resolved: Use test credentials for development |
| User email conflicts between providers | High | Open: Need to define merge strategy |

## Success Metrics

- Signup drop-off rate decreases from 40% to under 20%
- 30% of new signups use OAuth within first month

---

## Agent Pipeline Notes

### Scope Classification
- **Has UI**: Yes
- **Has API**: Yes
- **Has Database Changes**: Yes
- **Has External Integrations**: Yes (Google, GitHub OAuth)
- **Estimated Complexity**: Medium (4-10 files)

### Agent Hints
- **Architect**: Use NextAuth.js v5 patterns. Reference their official Next.js App Router guide.
- **Designer**: Follow existing button styles. OAuth buttons should use official brand colors per provider guidelines.
- **Developer**: Check existing auth setup in `/src/lib/auth.ts` and extend it. Prisma schema changes need a migration.
- **Tester**: Test the full OAuth callback flow with mocked providers. Test account linking edge cases.
- **Reviewer**: Pay special attention to token storage security and PKCE implementation.
