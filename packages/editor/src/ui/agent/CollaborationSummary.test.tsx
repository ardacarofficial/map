import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CollaborationSummary, type CollaborationParticipant } from "./CollaborationSummary";

vi.mock("../../i18n", () => ({ t: (key: string, params?: { count?: number }) => params?.count === undefined ? key : `${key}:${params.count}` }));
const member = (overrides: Partial<CollaborationParticipant> = {}): CollaborationParticipant => ({
  id: "member-a", clientInfo: { name: "River agent", version: "1" }, role: "coordinator", state: "running", detached: false,
  counters: { changedCells: 12 }, claims: [{ mapId: "village", layerIds: ["ground"], region: { x: 0, y: 8, width: 16, height: 8 } }], ...overrides,
});
const render = (members: CollaborationParticipant[], fault = false) => renderToStaticMarkup(<CollaborationSummary fault={fault} members={members} mapName={() => "Village"} layerName={() => "Ground"} />);

describe("shared draft participant summary", () => {
  it("shows attributed progress and spatial claims under one shared review decision", () => {
    const html = render([member(), member({ id: "member-b", clientInfo: { name: "House agent", version: "1" }, role: "member", state: "ready", counters: { changedCells: 5 } })]);
    expect(html).toContain("ai.collaboration.members:2");
    expect(html).toContain("ai.collaboration.review");
    expect(html).toContain("River agent"); expect(html).toContain("House agent");
    expect(html).toContain("ai.collaboration.running"); expect(html).toContain("ai.collaboration.ready");
    expect(html).toContain("ai.transaction.cells:12"); expect(html).toContain("ai.transaction.cells:5");
    expect(html).toContain("Village"); expect(html).toContain("Ground");
    expect(html).toContain("0"); expect(html).toContain("16");
    expect(html).not.toContain("<button");
  });
  it("keeps a disconnected ready contribution reviewable and marks self-cancelled work removed", () => {
    const retained = render([member({ state: "ready", detached: true })]);
    expect(retained).toContain("ai.collaboration.ready");
    expect(retained).toContain("ai.collaboration.disconnected");
    expect(retained).toContain("ai.collaboration.retained");
    expect(retained).toContain("ai.collaboration.claims");
    expect(retained).not.toContain("ai.collaboration.removed");
    const removed = render([member({ state: "cancelled", detached: true })]);
    expect(removed).toContain("ai.collaboration.removed");
    expect(removed).toContain("ai.collaboration.claimsReleased");
    expect(removed).not.toContain("ai.collaboration.retained");
    expect(removed).not.toContain("ai.transaction.cells:12");
  });
  it("does not promise preserved contribution or released claims during rollback", () => {
    const html = render([member({ state: "cancelling", detached: true })]);
    expect(html).toContain("ai.collaboration.cancelling");
    expect(html).not.toContain("ai.collaboration.retained");
    expect(html).not.toContain("ai.collaboration.claimsReleased");
  });
  it("replaces the approval promise with recovery guidance only for a faulted draft", () => {
    const html = render([member({ state: "stopped" })], true);
    expect(html).toContain("ai.collaboration.recoveryRequired");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("ai.collaboration.review");
  });
  it("identifies coordinator preparation before the first region claim", () => {
    const html = render([member({ claims: [] })]);
    expect(html).toContain("ai.collaboration.preparing");
    expect(html).not.toContain("<details");
  });
  it("escapes client names and omits the claims disclosure when no region was claimed", () => {
    const html = render([member({ clientInfo: { name: "<script>client</script>", version: "1" }, claims: [] })]);
    expect(html).toContain("&lt;script&gt;client&lt;/script&gt;");
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<details");
  });
});
