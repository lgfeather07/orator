/**
 * NSAA speech ballots, transcribed from the official ballot PDF (11 events).
 * Every ballot shares the same scoring: a rank with no ties, a rating from 35 to 50,
 * a recorded time, a reason for decision, and event-specific disqualification grounds.
 */
export type BallotEvent = {
  id: string; name: string; short: string;
  /** Speaking time limits in seconds. `min` is only set for events with an undertime penalty. */
  /** `classAMax` is set where Class A schools have a shorter limit. */
  time: { min?: number; max: number; classAMax?: number; note?: string };
  criteria: { name: string; questions: string[] }[];
  disqualifications: string[];
};

export const RATING_BANDS = [
  { label: 'Superior', values: [50, 49, 48, 47, 46, 45] },
  { label: 'Excellent', values: [44, 43, 42, 41, 40] },
  { label: 'Good', values: [39, 38, 37, 36, 35] },
];
/** Section marks run from 1 to this value. */
export const MARK_MAX = 10;
/** Going over (or under) the limit by more than this many seconds lowers the entry one rank. */
export const TIME_GRACE_SECONDS = 30;

const organization = ['Is there an appropriate introduction?', 'Is the speech logical and coherent?', 'Is the structure clear and suitable?', 'Are ideas effectively linked?', 'Is the ending clear and satisfying?'];
const styleLanguage = ['Is language/vocabulary appropriate to the purpose?', 'Is there effective word choice?', 'Are grammar and mechanics correct?', 'Are color, variety, clarity, and vividness present?'];
const thesis = ['Is there a clearly stated thesis?', 'Is the thesis appropriate to the purpose of this event?', 'Is the thesis valid, justified, and reasonable?', 'Is the thesis genuine and creative?', 'Is there depth of analysis?', 'Is the thesis relevant?'];
const actingCriteria = (business: string) => [
  { name: 'Selection', questions: ['Is the performance appropriate to the event and the actors?', 'Is the performance sufficiently challenging?', 'Is adequate and effective background material provided?', 'Is the cutting arranged satisfactorily?'] },
  { name: 'Understanding', questions: ['Do the actors understand the selection and convey this understanding to the audience?'] },
  { name: 'Characterization', questions: ['Do the actors demonstrate good vocal qualities?', 'Do the actors convey understanding of the characters to the audience?', 'Are the actors believable characters?'] },
  { name: 'Ensemble effect', questions: ['Do the actors convey emotional responsiveness?', business] },
  { name: 'Overall effectiveness', questions: ['Do the actors convey the mood of the selection?', 'Is there a feeling of completeness?', 'Is the playwright’s purpose accomplished?'] },
];
const proseCriteria = [
  { name: 'Selection', questions: ['Is the literature appropriate to the event?', 'Is there an introduction which heightens understanding?', 'Is this an original performance?', 'Are the author and title clearly communicated?', 'Is the program/theme unified?', 'If used, are transitions suitable?'] },
  { name: 'Physical responsiveness', questions: ['Does the contestant’s bodily responsiveness enhance the presentation?', 'Are poise, polish, and control present?', 'Are gestures and movement effective?', 'If used, are characters differentiated physically?', 'If used, is the manuscript unobtrusive?'] },
  { name: 'Vocal qualities', questions: ['Does the contestant have vocal variety, control, strength, and believability?', 'Do pace, pause, inflection, emphasis, and volume enhance the presentation?', 'If used, are characters clearly distinguished?'] },
  { name: 'Presentation', questions: ['Is the contestant believable and controlled?', 'Does the contestant understand the material and transfer its meaning to the audience?', 'If used, is characterization consistent?', 'Does characterization remain within the realm of suggestion?', 'If used, is narration distinguished from characterization?'] },
  { name: 'Overall effectiveness', questions: ['Is the presentation spontaneous and genuine?', 'Is the audience left with an understanding of the author’s purpose?', 'Is there evidence of universality?', 'Is there evidence of suggestion?', 'Is there evidence of individuality?', 'Is there a strong sense of mood?'] },
];

export const ballotEvents: BallotEvent[] = [
  { id: 'info', name: 'Informative', short: 'Informative', time: { max: 600 },
    criteria: [
      { name: 'Thesis', questions: thesis },
      { name: 'Organization', questions: organization },
      { name: 'Content', questions: ['Is there sufficient supporting material?', 'Is supporting material relevant, reliable, adequate, and/or documented?', 'Are critical thought, creativity, and originality present?', 'Do examples and details add interest and depth?', 'Does the speech maintain attention and interest?'] },
      { name: 'Style & language', questions: styleLanguage },
      { name: 'Delivery', questions: ['Is the delivery technique appropriate to the purpose?', 'Is the delivery direct and extemporaneous?', 'Is the delivery polished, poised, and conversational?', 'Does the delivery contain effective eye contact, movement, timing, volume, poise, and pace?', 'Are there effective gestures?'] },
    ],
    disqualifications: ['Obviously not having an original performance.', 'Using more than one 4” x 6” notecard.', 'Using a notecard larger than 4” x 6”.'] },
  { id: 'persuasive', name: 'Persuasive', short: 'Persuasive', time: { max: 600 },
    criteria: [
      { name: 'Thesis', questions: thesis },
      { name: 'Organization', questions: organization },
      { name: 'Content', questions: ['Is there sufficient supporting material?', 'Is supporting material relevant, reliable, adequate, and/or documented?', 'Is there critical thought, creativity, and originality?', 'Do examples and details add interest and depth?', 'Does the speech maintain attention and interest?'] },
      { name: 'Style & language', questions: styleLanguage },
      { name: 'Delivery', questions: ['Is the delivery appropriate to the purpose?', 'Is it direct and extemporaneous?', 'Is the delivery polished, poised, and conversational?', 'Does the delivery contain effective eye contact, movement, timing, volume, poise, and pace?', 'Are there effective gestures?'] },
    ],
    disqualifications: ['Extensive paraphrasing.', 'Use of visual aids.', 'Obviously not having an original speech.', 'Not providing a written or electronic manuscript to the judge at the conclusion of the speech.', 'Having more than 150 quoted words.', 'Use of one or more notecards.'] },
  { id: 'extemp', name: 'Extemporaneous', short: 'Extemp', time: { min: 300, max: 420, note: 'The penalty applies only if time signals were provided or available.' },
    criteria: [
      { name: 'Analysis of topic', questions: ['Is the purpose made clear?', 'Is there a clear thesis?', 'Does the contestant stick to the general and exact purpose of the topic?', 'Does the speaker answer the question?'] },
      { name: 'Organization', questions: organization },
      { name: 'Content', questions: ['Is there sufficient supporting material?', 'Is supporting material relevant, reliable, adequate, and/or documented?', 'Is there critical thought?', 'Is there creativity and originality?', 'Do examples and details add interest and depth?', 'Does the speech maintain attention and interest?'] },
      { name: 'Style & language', questions: styleLanguage },
      { name: 'Delivery', questions: ['Is the delivery appropriate to the purpose?', 'Is the delivery direct and extemporaneous?', 'Is the delivery polished, poised, and conversational?', 'Is there effective eye contact?', 'Does the delivery include effective eye contact, gestures, movement, timing, volume, poise, and pace?'] },
    ],
    disqualifications: ['Not presenting the judge with the topic drawn.', 'Not speaking on topic drawn.', 'Using more than one 4” x 6” notecard.', 'Using a card larger than 4” x 6” notecard.', 'Violating preparation room guidelines.'] },
  { id: 'entertainment', name: 'Entertainment', short: 'Entertainment', time: { max: 480 },
    criteria: [
      { name: 'Thesis', questions: thesis },
      { name: 'Organization', questions: organization },
      { name: 'Content', questions: ['Does the speech entertain and amuse?', 'Is there appropriate supporting material?', 'Is there creativity and originality?', 'Does it contain elements of humor and/or fascination?', 'Is it more than a series of jokes?', 'Does the speech maintain attention and interest?'] },
      { name: 'Style & language', questions: styleLanguage },
      { name: 'Delivery', questions: ['Is the delivery appropriate to the purpose?', 'Is the delivery direct and extemporaneous?', 'Is the delivery polished, poised, and conversational?', 'Does the delivery include effective eye contact, gestures, movement, timing, volume, poise, and pace?'] },
    ],
    disqualifications: ['Obviously not having an original performance.', 'Using more than one 4” x 6” notecard.', 'Using a notecard larger than 4” x 6”.', 'Use of costumes or make-up.'] },
  { id: 'oid', name: 'Oral Interpretation of Drama', short: 'OID', time: { max: 900, classAMax: 600 },
    criteria: [
      { name: 'Selection', questions: ['Is the selection suitable for this group and the event?', 'Is the selection arranged well?'] },
      { name: 'Presentation', questions: ['Is there an introduction that prepares listeners for the reading?', 'Does the selection build to a climax?', 'Is there unity in the whole presentation?', 'Does it sustain a mood?'] },
      { name: 'Characterization', questions: ['Are the contestants believable?', 'Do they portray the nuances of character?', 'Do they utilize nonverbal as well as verbal communication?', 'Are they poised?'] },
      { name: 'Ensemble effect', questions: ['Do the contestants work well together?', 'Do they handle their scripts well?', 'Does the staging enhance the presentation?', 'Is there bodily responsiveness to the dialogue?', 'Is there interaction between contestants?', 'Are the movements and gestures suggested rather than acted?', 'Is this an ensemble rather than several solos?', 'Is off-stage focus or on-stage focus, or a combination of both, used effectively?'] },
      { name: 'Overall effectiveness', questions: ['Is there empathetic appeal?', 'Do the contestants understand the material and convey the thought and mood to the audience?', 'Is there a feeling of completeness at the end? Is this a unified, balanced presentation?', 'Do the contestants bring this play to life in the audience’s mind?'] },
    ],
    disqualifications: ['Deliberate touching during any part of the presentation, including the introduction.', 'Using costumes, make-up, properties, special lighting, or mechanical sound effects.', 'Each contestant not in possession of a paper manuscript. Not providing a paper manuscript at the request of the judge at the conclusion of the speech.', 'Less than three or more than five contestants.', 'Having more than five total staging devices or using boxes as more than levels.'] },
  { id: 'poi', name: 'Program Oral Interpretation', short: 'POI', time: { max: 600 },
    criteria: [
      { name: 'Selections', questions: ['Do the selections effectively develop the theme?', 'Is there an effective introduction which heightens audience understanding and appreciation of the selections?', 'Are there suitable transitions provided if/where needed?', 'Are the transitions, if provided, relevant?'] },
      { name: 'Physical responsiveness', questions: ['Is the script handled effectively?', 'Does the contestant display good poise, gestures, and posture?', 'Is the blocking creative and effective?'] },
      { name: 'Vocal qualities', questions: ['Are effective control, variety, and strength present?', 'Are the techniques of articulation, projection and inflection used?'] },
      { name: 'Presentation', questions: ['Is the mood maintained?', 'Is there believability?', 'Is there consistency?', 'If multiple characters are used, are they easily distinguished?', 'If narration is used, is it effective?', 'Is there differentiation between character(s) and narration?'] },
      { name: 'Overall effectiveness', questions: ['Do the narration and characterization complement each other?', 'Is the presentation spontaneous and genuine?', 'Did the program create a compelling performance centered around a theme, idea, or argument?'] },
    ],
    disqualifications: ['The speaker was not in possession of a script.', 'The speaker used less than two literary selections.', 'The speaker did not cite all titles and authors in the introduction.', 'The presentation did not include an argumentative or persuasive theme.'] },
  { id: 'poetry', name: 'Poetry', short: 'Poetry', time: { min: 360, max: 480 },
    criteria: [
      { name: 'Selection(s)', questions: ['Is the literature appropriate to the event?', 'Is there an introduction which heightens understanding?', 'Are authors/titles clearly communicated?', 'Is the program/theme unified?', 'If used, are transitions suitable?'] },
      { name: 'Physical responsiveness', questions: ['Is the script handled effectively?', 'Does the contestant’s bodily responsiveness enhance the presentation?', 'Are there poise, polish, and control present?', 'Are gestures and movement effective?'] },
      { name: 'Vocal qualities', questions: ['Does the contestant have vocal variety, control, strength, and believability?', 'Do pace, pause, inflection, emphasis, and volume enhance the presentation?', 'Are articulation and pronunciation clear, and correct?'] },
      { name: 'Presentation', questions: ['Is the contestant believable?', 'Does the contestant understand the material and transfer this understanding to the audience?', 'Is there a feeling that the contestant is controlled?', 'Does the contestant use poetic elements (rhyme, rhythm, imagery, etc.) to their best advantage?'] },
      { name: 'Overall effectiveness', questions: ['Is the presentation spontaneous and genuine?', 'Is the audience left with an understanding of the poet’s (or poets’) purpose(s)?', 'Is there evidence of universality?', 'Is there evidence of suggestion?', 'Is there evidence of individuality?', 'Is there a strong sense of mood?'] },
    ],
    disqualifications: ['The speaker was not in possession of a script.', 'The speaker did not present a paper manuscript at the request of the judge at the conclusion of the speech.'] },
  { id: 'serious', name: 'Serious', short: 'Serious', time: { max: 600 }, criteria: proseCriteria, disqualifications: [] },
  { id: 'humorous', name: 'Humorous', short: 'Humorous', time: { max: 600 }, criteria: proseCriteria, disqualifications: [] },
  { id: 'duet', name: 'Duet Acting', short: 'Duet Acting', time: { max: 720 },
    criteria: actingCriteria('Do the actors use stage business, action/reaction, facial expressions, and movement?'),
    disqualifications: ['Using scripts, hand props, mechanical sound effects, costuming, or make-up.', 'Using more than two actors.', 'Using more than two classroom chairs and a table.'] },
  { id: 'duo', name: 'Duo Interpretation', short: 'Duo', time: { max: 600 },
    criteria: actingCriteria('Do the actors use stage business, action/reaction, facial expression, and movement?'),
    disqualifications: ['Using scripts, hand props, mechanical sound effects, costuming, or make-up.', 'Using more than two actors.', 'Using staging devices.', 'Actors making direct eye-contact with each other or deliberately touching each other during the presentation, other than during introductory material.'] },
];
