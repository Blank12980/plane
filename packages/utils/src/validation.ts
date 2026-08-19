/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Input Validation Utilities
 * Following OWASP Input Validation best practices using allowlist approach
 *
 * Security: Blocks injection-risk characters: < > ' " % # { } [ ] * ^ !
 * These patterns are designed to prevent XSS, SQL injection, template injection,
 * and other security vulnerabilities while maintaining good UX
 */

// =============================================================================
// VALIDATION REGEX PATTERNS
// =============================================================================

/**
 * Person Name Pattern (for first_name, last_name)
 * Allows: Unicode letters (\p{L}), spaces, hyphens, apostrophes
 * Use case: Accommodates international names like "José", "李明", "محمد", "Müller"
 * Blocks: Injection-risk characters and special symbols
 */
export const PERSON_NAME_REGEX = /^[\p{L}\s'-]+$/u;

/**
 * Display Name Pattern (for display_name, usernames)
 * Allows: Unicode letters (\p{L}), numbers (\p{N}), underscore, period, hyphen
 * Use case: International usernames like "josé_123", "李明.dev", "müller-2024"
 * Blocks: Spaces and injection-risk characters
 */
export const DISPLAY_NAME_REGEX = /^[\p{L}\p{N}_.-]+$/u;

/**
 * Company/Organization Name Pattern (for company_name, workspace names)
 * Allows: Unicode letters (\p{L}), numbers (\p{N}), spaces, underscores, hyphens
 * Use case: International business names like "Société Générale", "株式会社", "Müller GmbH"
 * Blocks: Special punctuation and injection-risk chars
 */
export const COMPANY_NAME_REGEX = /^[\p{L}\p{N}\s_-]+$/u;

/**
 * URL Slug Pattern (for workspace slugs, URL-safe identifiers)
 * Allows: Unicode letters (\p{L}), numbers (\p{N}), underscores, hyphens
 * Use case: International URL-safe identifiers like "josé-workspace", "李明-project"
 * Blocks: Spaces and special characters (URL encoding will handle Unicode in actual URLs)
 */
export const SLUG_REGEX = /^[\p{L}\p{N}_-]+$/u;

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * @description Validates person names (first name, last name)
 * @param {string} name - Name to validate
 * @returns {boolean | string} true if valid, error message if invalid
 * @example
 * validatePersonName("John") // returns true
 * validatePersonName("O'Brien") // returns true
 * validatePersonName("Jean-Paul") // returns true
 * validatePersonName("John<script>") // returns error message
 */
export const validatePersonName = (name: string): boolean | string => {
  if (!name || name.trim() === "") {
    return "Имя обязательно";
  }

  if (name.length > 50) {
    return "Имя должно быть не длиннее 50 символов";
  }

  if (hasInjectionRiskChars(name)) {
    return "Имя не может содержать спецсимволы вроде < > ' \" { } [ ] * ^ ! # %";
  }

  if (!PERSON_NAME_REGEX.test(name)) {
    return "Имя может содержать только буквы, пробелы, дефисы и апострофы";
  }

  return true;
};

/**
 * @description Validates display names and usernames
 * @param {string} displayName - Display name to validate
 * @returns {boolean | string} true if valid, error message if invalid
 * @example
 * validateDisplayName("john_doe") // returns true
 * validateDisplayName("john.doe-123") // returns true
 * validateDisplayName("john doe") // returns error message (spaces not allowed)
 * validateDisplayName("john<>doe") // returns error message
 */
export const validateDisplayName = (displayName: string): boolean | string => {
  if (!displayName || displayName.trim() === "") {
    return true; // Display name is optional in most cases
  }

  if (displayName.length > 50) {
    return "Отображаемое имя должно быть не длиннее 50 символов";
  }

  if (hasInjectionRiskChars(displayName)) {
    return "Отображаемое имя не может содержать спецсимволы вроде < > ' \" { } [ ] * ^ ! # %";
  }

  if (!DISPLAY_NAME_REGEX.test(displayName)) {
    return "Отображаемое имя может содержать только буквы, цифры, точки, дефисы и подчёркивания";
  }

  return true;
};

/**
 * @description Validates company and organization names
 * @param {string} companyName - Company name to validate
 * @param {boolean} required - Whether the field is required
 * @returns {boolean | string} true if valid, error message if invalid
 * @example
 * validateCompanyName("Acme Corp") // returns true
 * validateCompanyName("Acme_Corp-123") // returns true
 * validateCompanyName("Acme{Corp}") // returns error message
 */
export const validateCompanyName = (companyName: string, required: boolean = false): boolean | string => {
  if (!companyName || companyName.trim() === "") {
    return required ? "Название компании обязательно" : true;
  }

  if (companyName.length > 80) {
    return "Название компании должно быть не длиннее 80 символов";
  }

  if (hasInjectionRiskChars(companyName)) {
    return "Название компании не может содержать спецсимволы вроде < > ' \" { } [ ] * ^ ! # %";
  }

  if (!COMPANY_NAME_REGEX.test(companyName)) {
    return "Название компании может содержать только буквы, цифры, пробелы, дефисы и подчёркивания";
  }

  return true;
};

/**
 * @description Validates company and organization names
 * @param {string} workspaceName - Workspace name to validate
 * @param {boolean} required - Whether the field is required
 * @returns {boolean | string} true if valid, error message if invalid
 * @example
 * validateWorkspaceName("Acme Corp") // returns true
 * validateWorkspaceName("Acme_Corp-123") // returns true
 * validateWorkspaceName("Acme{Corp}") // returns error message
 */
export const validateWorkspaceName = (workspaceName: string, required: boolean = false): boolean | string => {
  if (!workspaceName || workspaceName.trim() === "") {
    return required ? "Название рабочего пространства обязательно" : true;
  }

  if (workspaceName.length > 80) {
    return "Название рабочего пространства должно быть не длиннее 80 символов";
  }

  if (hasInjectionRiskChars(workspaceName)) {
    return "Название рабочего пространства не может содержать спецсимволы вроде < > ' \" { } [ ] * ^ ! # %";
  }

  if (!COMPANY_NAME_REGEX.test(workspaceName)) {
    return "Название рабочего пространства может содержать только буквы, цифры, пробелы, дефисы и подчёркивания";
  }

  return true;
};

/**
 * @description Validates URL slugs and identifiers
 * @param {string} slug - Slug to validate
 * @returns {boolean | string} true if valid, error message if invalid
 * @example
 * validateSlug("my-workspace") // returns true
 * validateSlug("my_workspace_123") // returns true
 * validateSlug("my workspace") // returns error message (spaces not allowed)
 */
export const validateSlug = (slug: string): boolean | string => {
  if (!slug || slug.trim() === "") {
    return "Идентификатор обязателен";
  }

  if (slug.length > 48) {
    return "Идентификатор должен быть не длиннее 48 символов";
  }

  if (hasInjectionRiskChars(slug)) {
    return "Идентификатор не может содержать спецсимволы вроде < > ' \" { } [ ] * ^ ! # %";
  }

  if (!SLUG_REGEX.test(slug)) {
    return "Идентификатор может содержать только буквы, цифры, дефисы и подчёркивания";
  }

  return true;
};

/**
 * @description Checks if a string contains any injection-risk characters
 * @param {string} input - String to check
 * @returns {boolean} true if injection-risk characters found
 * @example
 * hasInjectionRiskChars("Hello World") // returns false
 * hasInjectionRiskChars("Hello<script>") // returns true
 */
export const hasInjectionRiskChars = (input: string): boolean => {
  const injectionRiskPattern = /[<>'"{}[\]*^!#%]/;
  return injectionRiskPattern.test(input);
};
