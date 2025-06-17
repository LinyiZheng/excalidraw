import React,{useEffect,useState} from "react";
import ReactDom from "react-dom/client";
import {BrowserRouter as Router,Route,Routes,Navigate, BrowserRouter} from "react-router-dom";
import App from "./App";
import Login from "./Login";

function Root(){
    const [loggedIn,setLoggedIn] = useState<boolean | null>(null);

    useEffect(()=>{
        fetch("http://localhost:8080/api/me",{
            credentials:"include",
        })
        .then(res=>{
            setLoggedIn(res.ok);
        });        
    },[]);

    if(loggedIn === null){return <p>加载中...</p>};

    return(
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<Login />} />
            <Route path="/" element={loggedIn ? <App /> : <Navigate to="/login" />} />
            </Routes>
        </BrowserRouter>
    );
}

ReactDom.createRoot(document.getElementById("root")!).render(<Root />);