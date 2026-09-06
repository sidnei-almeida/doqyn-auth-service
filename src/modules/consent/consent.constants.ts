/**
 * A versão do texto de consentimento operacional que a pessoa aceita ao entrar.
 *
 * Morava em `access-requests`, que saiu junto com o pedido de acesso — mas o consentimento não
 * era do pedido: é de quem entra, por qualquer porta. Hoje quem entra entra por convite, e aceita
 * o mesmo texto no aceite.
 */
export const CONSENT_TEXT_VERSION = 'operational-notifications-v1';
