import { LoopsClient } from "loops";
import type { MarketingProvider, MarketingContact, MarketingEvent } from "./marketing";

export class LoopsProvider implements MarketingProvider {
  readonly name = "loops";
  private client: LoopsClient;

  constructor(apiKey: string) {
    this.client = new LoopsClient(apiKey);
  }

  async upsertContact(contact: MarketingContact): Promise<void> {
    const properties: Record<string, string | number | boolean> = {
      ...contact.properties,
    };
    if (contact.firstName) properties.firstName = contact.firstName;
    if (contact.lastName) properties.lastName = contact.lastName;
    if (contact.plan) properties.userGroup = contact.plan;

    await this.client.updateContact({
      email: contact.email,
      userId: contact.userId,
      properties,
    });
  }

  async deleteContact(email: string): Promise<void> {
    await this.client.deleteContact({ email });
  }

  async sendEvent(event: MarketingEvent): Promise<void> {
    await this.client.sendEvent({
      email: event.email,
      userId: event.userId,
      eventName: event.name,
      eventProperties: event.properties ?? {},
    });
  }
}
