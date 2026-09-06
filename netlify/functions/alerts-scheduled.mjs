import { evaluarAlertasServidor } from "./apps-script.mjs";

export default async () => {
  try {
    await evaluarAlertasServidor(false);
  } catch (error) {
    console.error("Error en alertas programadas:", error);
  }
};

export const config = {
  schedule: "* * * * *"
};
