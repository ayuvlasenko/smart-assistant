import { ObjectId } from "mongodb";
import { Translate } from "../i18n-service.js";
import { UserEntity } from "../users/user-entity.js";
import {
    listKnownPokerParticipants,
    PokerRoomEntity,
} from "./poker-room-entity.js";

const nameGraphemes = 20;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function describePokerParticipants(
    t: Translate,
    room: PokerRoomEntity,
    users: UserEntity[],
    viewerId: ObjectId,
): Map<string, string> {
    const named = listKnownPokerParticipants(room).map((participant) => {
        const user = users.find(({ _id }) => _id.equals(participant.userId));

        return {
            participant,
            user,
            name: truncateName(
                user?.firstName ??
                    (user?.username ? `@${user.username}` : undefined) ??
                    t("poker:participant"),
            ),
        };
    });

    return new Map(
        named.map(({ participant, user, name }) => {
            const isNameShared =
                named.filter((other) => other.name === name).length > 1;
            const parts = [`${participant.emoji} ${name}`];

            if (isNameShared && user?.username && user.firstName) {
                parts.push(`(@${user.username})`);
            }

            if (participant.userId.equals(viewerId)) {
                parts.push(`(${t("poker:you")})`);
            }

            return [participant.userId.toHexString(), parts.join(" ")];
        }),
    );
}

function truncateName(name: string): string {
    const parts = [...graphemes.segment(name)].map(({ segment }) => segment);

    return parts.length > nameGraphemes
        ? `${parts.slice(0, nameGraphemes).join("")}…`
        : name;
}
