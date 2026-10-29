import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/modules/pull-requests/domain/pr-list-rows";

interface PrAuthorAvatarProps {
  author: string;
  authorAvatar: string;
}

export function PrAuthorAvatar({ author, authorAvatar }: PrAuthorAvatarProps) {
  return (
    <Avatar size="sm">
      {authorAvatar !== "" ? <AvatarImage src={authorAvatar} alt="" /> : null}
      <AvatarFallback>{initialsOf(author)}</AvatarFallback>
    </Avatar>
  );
}
