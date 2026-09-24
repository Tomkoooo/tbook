import { EventModel, type IEvent } from "../models/event";

export const eventRepository = {
  findById(id: string): Promise<IEvent | null> {
    return EventModel.findById(id).exec();
  },
  findByGroupId(groupId: string): Promise<IEvent[]> {
    return EventModel.find({ groupId }).sort({ sortOrder: 1, startDate: 1 }).exec();
  },
  findActiveByOrganizationId(organizationId: string): Promise<IEvent[]> {
    return EventModel.find({ organizationId, status: "active" }).sort({ startDate: 1 }).exec();
  },
  create(data: Partial<IEvent>): Promise<IEvent> {
    return EventModel.create(data);
  },
  updateById(id: string, update: Partial<IEvent>): Promise<IEvent | null> {
    return EventModel.findByIdAndUpdate(id, update, { new: true }).exec();
  },
};
