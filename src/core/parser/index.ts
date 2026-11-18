/** Task parser (ARCHITECTURE §5.2.1, PARSER_SPEC v1.0): pure, deterministic, no AI. */
export {
  DEFAULT_PLANNED_MIN,
  TEXT_MAX,
  WARNING_MESSAGE_KEYS,
  mixedUseFor,
  parseIntent,
  pickWarnings,
} from "./parseIntent";
export { COMMON_TLDS, SITES, buildLookup, findSites, hasKnownTld, isIpv4, normaliseHost } from "./sites";
export { SENSITIVE_HOSTS, SENSITIVE_SITES, isSensitiveHost } from "../exclusions/sensitive";
export type { SensitiveSite } from "../exclusions/sensitive";
export { MS_PER_MIN, NUMBER_WORDS, clockTarget, findDuration } from "./duration";
export { TRIGGER_VERBS, findObjective } from "./objective";
export { LEADING_FILLER, TRAILING_FILLER, buildLabel } from "./label";
export {
  GENERIC_WORDS,
  KEYWORDS_MAX,
  STOP_WORDS,
  buildKeywords,
  isWeakKeyword,
  isWeakPhrase,
  subjectPhrase,
} from "./keywords";
export {
  DETERMINERS,
  FUNCTION_WORDS,
  QUESTION_WORDS,
  isAllFunctionWords,
  isNumericToken,
  stripFunctionWords,
  QUANTITY_WORDS,
  SUBORDINATORS,
  TIME_WORDS,
  deriveSubject,
  properNounPhrases,
  sameText,
  startsWithSubordinator,
} from "./subject";
export { WARNING_CODES, WARNING_FIELDS, WARNING_ORDER, warning } from "./types";
export type {
  ParseCtx,
  ParseResult,
  ParseWarning,
  ParseWarningData,
  SiteDictionary,
  SiteEntry,
  Span,
  WarningCode,
  WarningField,
} from "./types";
