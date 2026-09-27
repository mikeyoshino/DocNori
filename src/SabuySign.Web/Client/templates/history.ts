/** Reversible document edits only; form values and PDF bytes never enter history. */
export class EditHistory<T> {
  private states: string[];
  private position = 0;
  constructor(
    initial: T,
    private readonly limit = 80,
  ) {
    this.states = [JSON.stringify(initial)];
  }
  record(value: T) {
    const next = JSON.stringify(value);
    if (next === this.states[this.position]) return;
    this.states.splice(this.position + 1);
    this.states.push(next);
    if (this.states.length > this.limit) this.states.shift();
    this.position = this.states.length - 1;
  }
  get canUndo() {
    return this.position > 0;
  }
  get canRedo() {
    return this.position < this.states.length - 1;
  }
  undo(): T | undefined {
    if (!this.canUndo) return;
    return JSON.parse(this.states[--this.position]);
  }
  redo(): T | undefined {
    if (!this.canRedo) return;
    return JSON.parse(this.states[++this.position]);
  }
}
