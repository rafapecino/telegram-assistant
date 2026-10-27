/**
 * Error con un mensaje pensado para el usuario (un dato no válido, o algo que puede arreglar él). El panel solo
 * enseña el mensaje de estos errores: el de los demás puede llevar detalles internos de Google, Groq o la base de
 * datos.
 */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}
