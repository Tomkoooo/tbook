import mongoose, { Schema, type Document, type Model, Types } from "mongoose";

export const questionTypes = ["rating", "choice", "text"] as const;
export type QuestionType = (typeof questionTypes)[number];

export interface SurveyQuestion {
  id: string;
  type: QuestionType;
  label: string;
  required: boolean;
  /** "choice" only. */
  choices: string[];
}

/**
 * A feedback form for an event.
 * - "survey": filled in once per guest; the guest proves who they are with
 *   their registration number / ID, or arrives through their personal
 *   {{feedbackUrl}} link. Answers are stored without the guest's identity.
 * - "kiosk": a tablet at the venue; anyone can tap a rating, any number of
 *   times, through the kiosk link.
 */
export interface ISurvey extends Document {
  organizationId: Types.ObjectId | null;
  eventId: Types.ObjectId;
  kind: "survey" | "kiosk";
  title: string;
  intro: string;
  thankYou: string;
  questions: SurveyQuestion[];
  active: boolean;
  /** Signs personal links; never leaves the server. */
  linkSecret: string;
  kioskTokenHash: string | null;
  kioskTokenHint: string;
  responseCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionSchema = new Schema<SurveyQuestion>(
  {
    id: { type: String, required: true },
    type: { type: String, enum: questionTypes, required: true },
    label: { type: String, required: true },
    required: { type: Boolean, default: false },
    choices: { type: [String], default: [] },
  },
  { _id: false },
);

const SurveySchema = new Schema<ISurvey>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "TBookOrganization", default: null, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "TBookEvent", required: true, index: true },
    kind: { type: String, enum: ["survey", "kiosk"], default: "survey" },
    title: { type: String, required: true },
    intro: { type: String, default: "" },
    thankYou: { type: String, default: "" },
    questions: { type: [QuestionSchema], default: [] },
    active: { type: Boolean, default: true },
    linkSecret: { type: String, required: true },
    kioskTokenHash: { type: String, default: null, index: true },
    kioskTokenHint: { type: String, default: "" },
    responseCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const SurveyModel: Model<ISurvey> = mongoose.models.TBookSurvey ?? mongoose.model<ISurvey>("TBookSurvey", SurveySchema, "tbooksurveys");

/** One submitted form. No guest identity. */
export interface ISurveyResponse extends Document {
  organizationId: Types.ObjectId | null;
  eventId: Types.ObjectId;
  surveyId: Types.ObjectId;
  source: "survey" | "kiosk" | "api";
  answers: Record<string, string | number>;
  createdAt: Date;
}

const SurveyResponseSchema = new Schema<ISurveyResponse>(
  {
    organizationId: { type: Schema.Types.ObjectId, default: null },
    eventId: { type: Schema.Types.ObjectId, required: true },
    surveyId: { type: Schema.Types.ObjectId, required: true, index: true },
    source: { type: String, enum: ["survey", "kiosk", "api"], required: true },
    answers: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const SurveyResponseModel: Model<ISurveyResponse> =
  mongoose.models.TBookSurveyResponse ?? mongoose.model<ISurveyResponse>("TBookSurveyResponse", SurveyResponseSchema, "tbooksurveyresponses");

/**
 * "This guest has answered this survey" — kept apart from the answers, as
 * a one-way hash, so answers can't be traced back to a guest.
 */
export interface ISurveyRespondent extends Document {
  surveyId: Types.ObjectId;
  hash: string;
}

const SurveyRespondentSchema = new Schema<ISurveyRespondent>(
  {
    surveyId: { type: Schema.Types.ObjectId, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: false },
);
SurveyRespondentSchema.index({ surveyId: 1, hash: 1 }, { unique: true });

export const SurveyRespondentModel: Model<ISurveyRespondent> =
  mongoose.models.TBookSurveyRespondent ?? mongoose.model<ISurveyRespondent>("TBookSurveyRespondent", SurveyRespondentSchema, "tbooksurveyrespondents");
