import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function login(){
    const [username,setUsername] = useState("");
    const [password,setPassword] = useState("");
    const navigate = useNavigate();

    const handleSubmit = async(e:React.FormEvent)=>{
        e.preventDefault();
        const res=await fetch("http://localhost:8080/api/login",{
            method:"POST",
            credentials:"include",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({username,password})
        });

        if(res.ok){
            navigate("/");
        }else{
            alert("Login failed");
        }
    }
    
    return(
        <form onSubmit={handleSubmit}>
        <h2>登录</h2>
        <input value={username} onChange={e => setUsername(e.target.value)} />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <button type="submit">登录</button>
      </form>
    )
    
}


