import pytest
from django.db.migrations.loader import MigrationLoader

from plane.db.models import APIToken


@pytest.mark.unit
def test_legacy_token_scopes_are_unrestricted_and_not_shared():
    first, second = APIToken(), APIToken()
    assert first.has_scope("issues:delete")
    first.scopes.append("read")
    assert second.scopes == []
    assert not first.has_scope("issues:write")


@pytest.mark.unit
def test_scoped_tokens_only_allow_explicit_scopes():
    token = APIToken(scopes=["read", "comments:write"])
    assert token.is_scoped
    assert token.has_scope("read")
    assert token.has_scope("comments:write")
    assert not token.has_scope("issues:delete")


@pytest.mark.unit
def test_api_scopes_and_client_changes_have_one_migration_head():
    loader = MigrationLoader(None)
    heads = loader.graph.leaf_nodes("db")
    assert len(heads) == 1
    assert not loader.detect_conflicts()
    state = loader.project_state(heads)
    token = state.apps.get_model("db", "APIToken")
    assert token._meta.get_field("scopes").get_default() == []
    member = state.apps.get_model("db", "WorkspaceMember")
    assert (3, "Client") in member._meta.get_field("role").choices
