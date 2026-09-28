/**
 * Moves this process's clock by SHOTS_CLOCK_OFFSET_MS, for the overhaul
 * screenshots only: `node --require ./shift-clock.cjs`.
 *
 * Screens of "today" taken at 01:00 in New York show a day with nothing in it.
 * The harness seeds the demo as of a chosen time (the seed's `llp.now`) and
 * runs the API, `next dev` and the browser as of the same time, so a Today
 * screenshot shows a working day whenever it is taken. Nothing else loads this.
 */
const offset = Number(process.env.SHOTS_CLOCK_OFFSET_MS || 0);

if (offset !== 0) {
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }

    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate;
}
