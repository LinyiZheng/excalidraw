import { Excalidraw } from "@excalidraw/excalidraw";
import { useEffect, useState } from "react";

export default function SimpleApp() {
    const [initialData, setInitialData] = useState<any | null>(null);
  
    useEffect(() => {
      fetch("http://localhost:8080/api/load", {
        credentials: "include",
      })
        .then((res) => res.json())
        .then((data) => setInitialData(data))
        .catch((err) => {
          console.error("加载失败", err);
          setInitialData({}); // fallback 空数据
        });
    }, []);
  
    if (!initialData) return <div>加载中...</div>;
  
    return (
      <div style={{ height: "100vh" }}>
        <Excalidraw
          initialData={initialData}
          onChange={(elements, appState) => {
            fetch("http://localhost:8080/api/save", {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ elements, appState }),
            });
          }}
        />
      </div>
    );
  }
