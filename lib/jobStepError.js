/** A webhook job step failure: `step` names what failed ('seam' | 'kisi' | 'zapier'). */
export class JobStepError extends Error {
  constructor(step, message) {
    super(message)
    this.step = step
  }
}
