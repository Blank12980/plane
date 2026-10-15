from rest_framework import serializers

from plane.db.models import IssueComment


class CommentThreadValidationMixin:
    comment_access = None

    def validate(self, attrs):
        attrs = super().validate(attrs)
        parent = attrs.get("parent", self.instance.parent if self.instance else None)
        if self.instance and "parent" in attrs and attrs["parent"] != self.instance.parent:
            raise serializers.ValidationError({"parent": "The comment thread cannot be changed."})
        if self.comment_access is not None:
            if attrs.get("access", self.comment_access) != self.comment_access:
                raise serializers.ValidationError({"access": "This comment visibility is not allowed."})
            attrs["access"] = self.comment_access
        if parent:
            issue_id = self.context.get("issue_id") or (self.instance.issue_id if self.instance else None)
            if str(parent.issue_id) != str(issue_id) or parent.deleted_at is not None:
                raise serializers.ValidationError({"parent": "Choose a comment in this work item."})
            if attrs.get("access", parent.access) != parent.access:
                raise serializers.ValidationError({"access": "Replies must have the same visibility as the thread."})
            attrs["access"] = parent.access
        elif self.instance and attrs.get("access", self.instance.access) != self.instance.access:
            if IssueComment.objects.filter(parent=self.instance).exists():
                raise serializers.ValidationError(
                    {"access": "Visibility cannot be changed while the thread has replies."}
                )
        return attrs
