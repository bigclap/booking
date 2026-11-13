from workplace_assistant.config import AssistantSettings


def test_no_model_is_selected_and_secret_is_redacted():
    settings = AssistantSettings(
        internal_api_key="test-internal-key-long-enough", openrouter_api_key="private-provider-key"
    )
    assert settings.openrouter_model is None
    assert not settings.llm_configured
    assert "private-provider-key" not in repr(settings)


def test_empty_compose_provider_configuration_is_unset():
    settings = AssistantSettings(
        internal_api_key="test-internal-key-long-enough", openrouter_api_key="", openrouter_model=""
    )
    assert settings.openrouter_api_key is None
    assert settings.openrouter_model is None
    assert not settings.llm_configured
