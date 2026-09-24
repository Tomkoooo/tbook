import { EventGroupModel, type IEventGroup } from "../models/event-group";

export const eventGroupRepository = {
  findById(id: string): Promise<IEventGroup | null> {
    return EventGroupModel.findById(id).exec();
  },
  findByOrganizationId(organizationId: string): Promise<IEventGroup[]> {
    return EventGroupModel.find({ organizationId }).exec();
  },
  /** Legacy public API auth: resolve the group owning a given API key hash. */
  findByApiKeyHash(apiKeyHash: string): Promise<IEventGroup | null> {
    return EventGroupModel.findOne({ apiKeyHash }).exec();
  },
  create(data: Partial<IEventGroup>): Promise<IEventGroup> {
    return EventGroupModel.create(data);
  },
  updateById(id: string, update: Partial<IEventGroup>): Promise<IEventGroup | null> {
    return EventGroupModel.findByIdAndUpdate(id, update, { returnDocument: "after" }).exec();
  },
};
