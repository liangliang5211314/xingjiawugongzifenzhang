function toCents(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    throw new Error("Invalid amount");
  }
  return Math.round(numeric * 100);
}

function fromCents(cents) {
  return Number((cents / 100).toFixed(2));
}

function roundShare(totalCents, ratio) {
  return Math.round(totalCents * Number(ratio));
}

module.exports = {
  toCents,
  fromCents,
  roundShare
};
