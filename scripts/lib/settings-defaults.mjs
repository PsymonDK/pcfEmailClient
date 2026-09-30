// The default jhrb_emailclientsetting row — ONE definition, shared by the demo seeder
// (scripts/deploy/seed-settings.mjs) and the downstream installer (scripts/install/post-import.mjs),
// so the two can never seed different defaults.
//
// A settings table with no rows is indistinguishable from one the agent cannot read: both resolve
// to "send as the agent". So an empty table is not a neutral starting state, it is a silently-off
// feature; this row makes the configured behaviour the actual behaviour.
export const DEFAULT_SETTINGS_ROW = {
  jhrb_name: 'Default',
  jhrb_isdefault: true,
  // The point of the feature: a customer replying to a case reaches the queue, not a person.
  jhrb_sendfromqueue: true,
  // The agent can still send as themselves when that is genuinely the right thing — pre-flight
  // will tell them if their own mailbox cannot deliver.
  jhrb_allowsenderoverride: true,
  // Where a NEW message's default recipient comes from. `customerid` because it is populated on
  // virtually every Case and accepts either an account or a contact — both valid party targets.
  jhrb_recipiententity: 'incident',
  jhrb_recipientlookup: 'customerid',
};
