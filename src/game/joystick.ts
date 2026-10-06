/** Owns one finger; releasing an unrelated finger must not stop movement. */
export class JoystickInput {
  pointer: number | undefined;
  x = 0;
  y = 0;
  start(pointer: number) {
    if (this.pointer !== undefined) return false;
    this.pointer = pointer;
    return true;
  }
  move(pointer: number, dx: number, dy: number, radius: number) {
    if (pointer !== this.pointer || radius <= 0) return false;
    const length = Math.hypot(dx, dy);
    const strength = Math.min(1, Math.max(0, (length / radius - .15) / .85));
    this.x = length ? dx / length * strength : 0;
    this.y = length ? dy / length * strength : 0;
    return true;
  }
  end(pointer: number) {
    if (pointer !== this.pointer) return false;
    this.reset();
    return true;
  }
  reset() { this.pointer = undefined; this.x = this.y = 0; }
}
