import { z } from "zod";

const jsonValue = z.json();
const jsonObject = z.record(z.string(), jsonValue);
const jsonArray = z.array(jsonValue);
const stateEntryType = z.union([z.string(), jsonObject, jsonArray]);
const description = z.union([z.string(), jsonObject, jsonArray]);
const descriptionOrNull = z.union([description, z.null()]);

const choiceCriteria = z.record(z.string().min(1).max(128), descriptionOrNull)
  .superRefine((value, context) => {
    const size = Object.keys(value).length;
    if (size < 1 || size > 255) context.addIssue({ code: "custom", message: "choice criteria must contain 1 to 255 options" });
  })
  .meta({ minProperties: 1, maxProperties: 255 });

const noulCriteria = z.union([
  z.object({
    true: descriptionOrNull,
    false: descriptionOrNull.optional(),
  }).strict(),
  z.object({
    true: descriptionOrNull.optional(),
    false: descriptionOrNull,
  }).strict(),
]);

const question = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), instructions: description, criteria: choiceCriteria }).strict(),
  z.object({ type: z.literal("score"), instructions: description, criteria: z.array(descriptionOrNull).min(2).max(10) }).strict(),
  z.object({ type: z.literal("noul"), instructions: description, criteria: noulCriteria.optional() }).strict(),
]);

const questions = z.record(z.string().min(1).max(128), question)
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) context.addIssue({ code: "custom", message: "questions must contain at least one question" });
  })
  .meta({ minProperties: 1 });

export const systemOneInputSchema = { state: stateEntryType, questions };
export const systemOneInput = z.object(systemOneInputSchema).strict();
export const MAX_REQUEST_BYTES = 1024 * 1024;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
}).strict();
const resultErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
}).strict();

const probabilityMap = z.record(z.string(), z.number().min(0).max(1))
  .meta({ minProperties: 1 });
const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().min(1),
  probabilities: probabilityMap,
  confidence: z.number().min(0).max(1),
}).passthrough();
const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number().min(0),
  legend: z.record(z.string(), jsonValue).meta({ minProperties: 2, maxProperties: 10 }),
  probabilities: probabilityMap,
  confidence: z.number().min(0).max(1),
}).passthrough();
const noulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
}).passthrough();
const answerSchema = z.union([choiceAnswerSchema, scoreAnswerSchema, noulAnswerSchema]);
const resultSuccessSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), answerSchema).meta({ minProperties: 1 }),
  usage: usageSchema,
}).passthrough();
export const systemOneOutputSchema = z.union([
  resultSuccessSchema,
  z.object({ error: resultErrorSchema }).strict(),
]);

export class TypeSafeInputError extends Error {
  constructor(message) { super(message); this.name = "TypeSafeInputError"; this.code = "invalid_input"; }
}

export class TypeSafeResponseError extends Error {
  constructor(message) { super(message); this.name = "TypeSafeResponseError"; this.code = "invalid_response"; }
}

function firstIssue(error) {
  const issue = error.issues?.[0];
  if (!issue) return "invalid system_one input";
  const path = issue.path?.length ? ` at ${issue.path.join(".")}` : "";
  return `${issue.message}${path}`;
}

export function validateSystemOneInput(value, maxBytes = MAX_REQUEST_BYTES) {
  const parsed = systemOneInput.safeParse(value);
  if (!parsed.success) throw new TypeSafeInputError(firstIssue(parsed.error));
  const serialized = JSON.stringify(parsed.data);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw new TypeSafeInputError(`system_one request exceeds ${maxBytes} bytes`);
  return parsed.data;
}

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
function responseError(message) { throw new TypeSafeResponseError(message); }
function numberInRange(value, minimum, maximum, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) responseError(`${label} must be a finite number between ${minimum} and ${maximum}`);
}
function validateProbabilityMap(probabilities, expectedKeys, label) {
  if (!isRecord(probabilities)) responseError(`${label} must be an object`);
  const actualKeys = Object.keys(probabilities).sort();
  const requiredKeys = [...expectedKeys].sort();
  if (actualKeys.length !== requiredKeys.length || actualKeys.some((key, index) => key !== requiredKeys[index])) responseError(`${label} must contain exactly the expected keys`);
  let total = 0;
  for (const key of requiredKeys) { numberInRange(probabilities[key], 0, 1, `${label}.${key}`); total += probabilities[key]; }
  if (Math.abs(total - 1) > 0.0001) responseError(`${label} probabilities must sum to 1`);
}
function validateChoiceAnswer(answer, question, id) {
  const keys = Object.keys(question.criteria);
  if (typeof answer.choice !== "string" || !Object.hasOwn(question.criteria, answer.choice)) responseError(`answer ${id}.choice must be one of the configured options`);
  validateProbabilityMap(answer.probabilities, keys, `answer ${id}.probabilities`);
  numberInRange(answer.confidence, 0, 1, `answer ${id}.confidence`);
}
function validateScoreAnswer(answer, question, id) {
  const keys = question.criteria.map((_, index) => String(index));
  numberInRange(answer.score, 0, question.criteria.length - 1, `answer ${id}.score`);
  if (!isRecord(answer.legend)) responseError(`answer ${id}.legend must be an object`);
  const legendKeys = Object.keys(answer.legend).sort();
  const sortedKeys = [...keys].sort();
  if (legendKeys.length !== sortedKeys.length || legendKeys.some((key, index) => key !== sortedKeys[index])) responseError(`answer ${id}.legend must contain every score level`);
  if (!Object.values(answer.legend).every(isJsonValue)) responseError(`answer ${id}.legend contains invalid JSON`);
  validateProbabilityMap(answer.probabilities, keys, `answer ${id}.probabilities`);
  numberInRange(answer.confidence, 0, 1, `answer ${id}.confidence`);
}
function validateAnswer(answer, question, id) {
  if (!isRecord(answer) || answer.type !== question.type) responseError(`answer ${id} type does not match its question`);
  if (question.type === "noul") numberInRange(answer.noul, 0, 1, `answer ${id}.noul`);
  if (question.type === "choice") validateChoiceAnswer(answer, question, id);
  if (question.type === "score") validateScoreAnswer(answer, question, id);
}

export function validateSystemOneResult(value, questions) {
  if (!isRecord(value)) responseError("TypeSafe response must be an object");
  if (typeof value.model !== "string" || !value.model.trim()) responseError("TypeSafe response model is missing");
  if (!isRecord(value.answers)) responseError("TypeSafe response answers are missing");
  const ids = Object.keys(questions);
  const answerIds = Object.keys(value.answers);
  if (answerIds.length !== ids.length || ids.some((id) => !Object.hasOwn(value.answers, id))) responseError("TypeSafe response must contain exactly one answer for every question");
  for (const id of ids) validateAnswer(value.answers[id], questions[id], id);
  if (!isRecord(value.usage)) responseError("TypeSafe response usage is missing");
  for (const name of ["input_tokens", "output_tokens"]) {
    if (!Number.isSafeInteger(value.usage[name]) || value.usage[name] < 0) responseError(`TypeSafe response usage.${name} must be a non-negative integer`);
  }
  return value;
}
